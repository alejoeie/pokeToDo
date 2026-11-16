import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createHandler } from "../server/app.js";
import {
  hashPassword,
  verifyPassword,
  readToken,
  sessionCookie,
  tokenHash,
} from "../server/security.js";
import { validateTask, taskAccess } from "../server/domain.js";

// In-memory adapter exercises HTTP handlers and authorization; it is not an Atlas test.
function matches(doc, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === "$or") return value.some((q) => matches(doc, q));
    if (value && typeof value === "object" && "$gt" in value)
      return doc[key] > value.$gt;
    return doc[key] === value;
  });
}
function memoryDB() {
  const maps = new Map();
  return {
    collection(name) {
      if (!maps.has(name)) maps.set(name, new Map());
      const data = maps.get(name);
      const find = (q) => [...data.values()].find((d) => matches(d, q));
      const apply = (doc, update, insert = false) => {
        if (insert) Object.assign(doc, update.$setOnInsert);
        Object.assign(doc, update.$set);
        for (const [k, v] of Object.entries(update.$inc || {}))
          doc[k] = (doc[k] || 0) + v;
      };
      return {
        async findOne(q) {
          const d = find(q);
          return d ? structuredClone(d) : null;
        },
        async insertOne(d) {
          if (data.has(d._id)) throw new Error("Duplicate");
          data.set(d._id, structuredClone(d));
        },
        async deleteOne(q) {
          const d = find(q);
          if (d) data.delete(d._id);
          return { deletedCount: d ? 1 : 0 };
        },
        async deleteMany(q) {
          for (const d of [...data.values()])
            if (matches(d, q)) data.delete(d._id);
        },
        async updateOne(q, u) {
          const d = find(q);
          if (d) apply(d, u);
        },
        async findOneAndUpdate(q, u, o) {
          let d = find(q);
          if (!d && o.upsert) {
            d = { _id: q._id };
            data.set(d._id, d);
            apply(d, u, true);
          } else if (d) apply(d, u);
          return d ? structuredClone(d) : null;
        },
        find(q) {
          let result = [...data.values()].filter((d) => matches(d, q));
          return {
            sort() {
              return this;
            },
            limit(n) {
              result = result.slice(0, n);
              return this;
            },
            async toArray() {
              return structuredClone(result);
            },
          };
        },
      };
    },
  };
}
async function request(
  handler,
  path,
  {
    method = "GET",
    body,
    cookie,
    origin = "http://localhost:4174",
    marker = "1",
  } = {},
) {
  const req = Readable.from(
    body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
  );
  req.method = method;
  req.url = path;
  req.socket = { remoteAddress: "127.0.0.1" };
  req.headers = {
    "content-type": "application/json",
    origin,
    "x-pokedo-request": marker,
    ...(cookie ? { cookie } : {}),
  };
  let output = "";
  const headers = {};
  const res = {
    status: 200,
    headersSent: false,
    setHeader(k, v) {
      headers[k.toLowerCase()] = v;
    },
    writeHead(status, h) {
      this.status = status;
      this.headersSent = true;
      Object.assign(headers, h);
    },
    end(value) {
      output = value?.toString() || "";
    },
  };
  await handler(req, res);
  let json;
  try {
    json = JSON.parse(output);
  } catch {
    json = output;
  }
  return { status: res.status, headers, body: json };
}
const payload = (extra = {}) => ({
  title: "Trace UART",
  description: "Reproduce first.",
  visibility: "personal",
  assigneeId: null,
  status: "encounter",
  companion: 252,
  priority: "Medium",
  due: "2026-12-01",
  minutes: 15,
  steps: [{ text: "Run one test", done: false }],
  ...extra,
});

test("passwords are salted; verification and secure-cookie properties", async () => {
  const password = "a sufficiently long test password";
  const a = await hashPassword(password),
    b = await hashPassword(password);
  assert.notEqual(a, b);
  assert(!a.includes(password));
  assert(await verifyPassword(password, a));
  assert.equal(await verifyPassword("wrong password", a), false);
  const cookie = sessionCookie("a".repeat(64), true);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(readToken(cookie), "a".repeat(64));
  assert.equal(readToken("pokedo_session=invalid"), null);
});
test("task validation rejects injection, bad dates, fields, and unbounded inputs", () => {
  assert.equal(validateTask(payload()).title, "Trace UART");
  for (const bad of [
    { ownerId: "sharlotte" },
    { title: { $ne: null } },
    { due: "2026-02-30" },
    { minutes: 1.2 },
    { steps: [] },
    { assigneeId: "third-user" },
    { companion: 99999 },
  ])
    assert.throws(() => validateTask(payload(bad)));
  assert.deepEqual(taskAccess("ale"), {
    $or: [{ ownerId: "ale" }, { visibility: "shared" }],
  });
});
test("API: sign-in, owner isolation, sharing, conflicts, CSRF, expiry, logout, and throttling", async () => {
  const db = memoryDB();
  let time = new Date("2026-11-16T12:00:00Z");
  const hash = await hashPassword("a sufficiently long test password");
  for (const id of ["ale", "sharlotte"])
    await db
      .collection("users")
      .insertOne({
        _id: id,
        name: id === "ale" ? "Ale" : "Sharlotte",
        passwordHash: hash,
        starter: null,
      });
  const handler = await createHandler({chooseCompanion:()=>252,
    db,
    origin: "http://localhost:4174",
    now: () => time,
  });
  const call = (path, options) => request(handler, path, options);
  const health = await call('/api/health');
  assert.equal(health.status, 200);assert.deepEqual(health.body, {ok:true});
  assert.equal((await call("/api/tasks")).status, 401);
  assert.equal((await call("/.env")).status, 404);
  assert.equal((await call("/server/db.js")).status, 404);
  const badLogin = await call("/api/login", {
    method: "POST",
    body: { login: "alejoeie", password: "wrong" },
  });
  assert.equal(badLogin.status, 401);
  const login = async (login) => {
    const result = await call("/api/login", {
      method: "POST",
      body: { login:login==='ale'?'alejoeie':'shar', password: "a sufficiently long test password" },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.user.passwordHash, undefined);
    return result.headers["set-cookie"].split(";")[0];
  };
  const ale = await login("ale"),
    sharlotte = await login("sharlotte");
  for(const oldLogin of ['ale','sharlotte'])assert.equal((await call('/api/login',{method:'POST',body:{login:oldLogin,password:'a sufficiently long test password'}})).status,401);
  const personal = await call("/api/tasks", {
    method: "POST",
    cookie: ale,
    body: payload({companion:6}),
  });
  assert.equal(personal.status, 201);
  assert.equal(personal.body.task.companion,252);
  const catalogResponse=await call('/pokemon-catalog.json');assert.equal(catalogResponse.status,200);assert(catalogResponse.body.species.length>=1000);
  const id = personal.body.task.id;
  assert.equal(personal.body.task.ownerId, "ale");
  assert.equal(
    (await call("/api/tasks", { cookie: sharlotte })).body.tasks.length,
    0,
  );
  for (const method of ["GET", "PATCH", "DELETE"])
    assert.equal(
      (
        await call(`/api/tasks/${id}`, {
          method,
          cookie: sharlotte,
          body: method === "PATCH" ? payload({ version: 1 }) : undefined,
        })
      ).status,
      404,
    );
  const shared = await call("/api/tasks", {
    method: "POST",
    cookie: ale,
    body: payload({ visibility: "shared", assigneeId: "sharlotte" }),
  });
  const sharedId = shared.body.task.id;
  assert.equal(
    (await call("/api/tasks", { cookie: sharlotte })).body.tasks.length,
    1,
  );
  assert.equal(
    (
      await call(`/api/tasks/${sharedId}`, {
        method: "PATCH",
        cookie: sharlotte,
        body: payload({ visibility: "personal", version: 1 }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(`/api/tasks/${sharedId}`, {
        method: "PATCH",
        cookie: sharlotte,
        body: payload({ visibility: "shared", status: "done", version: 1 }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(`/api/tasks/${sharedId}`, {
        method: "PATCH",
        cookie: ale,
        body: payload({ visibility: "shared", version: 1 }),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call("/api/tasks", {
        method: "POST",
        cookie: ale,
        body: payload({ ownerId: "sharlotte" }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/api/tasks", {
        method: "POST",
        cookie: ale,
        body: payload({ assigneeId: "sharlotte" }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/api/tasks", {
        method: "POST",
        cookie: ale,
        body: payload(),
        origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/tasks", {
        method: "POST",
        cookie: ale,
        body: payload(),
        marker: "",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/me", {
        method: "PATCH",
        cookie: sharlotte,
        body: { starter: 252 },
      })
    ).body.user.starter,
    252,
  );
  assert.equal(
    (
      await call("/api/me", {
        method: "PATCH",
        cookie: sharlotte,
        body: { starter: 7 },
      })
    ).status,
    400,
  );
  const session = await db
    .collection("sessions")
    .findOne({ _id: tokenHash(readToken(ale)) });
  assert(session);
  assert(!JSON.stringify(session).includes(readToken(ale)));
  time = new Date(time.getTime() + 604800001);
  assert.equal((await call("/api/me", { cookie: ale })).status, 401);
  const fresh = await login("ale");
  assert.equal(
    (await call("/api/logout", { method: "POST", cookie: fresh })).status,
    200,
  );
  assert.equal((await call("/api/me", { cookie: fresh })).status, 401);
  for (let i = 0; i < 10; i++)
    await call("/api/login", {
      method: "POST",
      body: { login: "shar", password: "wrong" },
    });
  assert.equal(
    (
      await call("/api/login", {
        method: "POST",
        body: { login: "shar", password: "wrong" },
      })
    ).status,
    429,
  );
});

test('frontend: authenticated session, create task, refresh, focus save, and sign out', async () => {
  const { readFile } = await import('node:fs/promises');
  const { createContext, runInContext } = await import('node:vm');
  const { randomUUID } = await import('node:crypto');
  const db = memoryDB();
  await db.collection('users').insertOne({ _id:'sharlotte', name:'Sharlotte', passwordHash:await hashPassword('a sufficiently long test password'), starter:252 });
  const handler = await createHandler({chooseCompanion:()=>252,db,origin:'http://localhost:4174'});
  const nodes = new Map(), classes = new Set();
  const dragCards=[], dropColumns=[]; let reducedMotion=true;
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      textContent:'',innerHTML:'',value:'',hidden:false,disabled:false,inert:false,open:false,style:{},dataset:{},classList:{add(){},remove(){}},contains:()=>false,
      setAttribute(){},insertAdjacentHTML(){},addEventListener(){},scrollIntoView(){},
      showModal(){this.open=true;},close(){this.open=false;},
    });
    return nodes.get(selector);
  }
  node('#task-form').elements = {
    owner:{value:'ours'},
    assigneeId:{value:'', options:[{value:''},{value:'ale'},{value:'sharlotte'}],selectedOptions:[{value:''}]},
  };
  let cookie;
  const context=createContext({
    document:{querySelector:node,querySelectorAll:selector=>selector==='[data-task-id]'?dragCards:selector==='.column[data-status]'?dropColumns:[],addEventListener(){},body:{classList:{add:v=>classes.add(v),remove:v=>classes.delete(v)}}},
    fetch:async(url, options={})=>{
      if(url==='/pokemon-catalog.json')return {ok:true,json:async()=>JSON.parse(await readFile(new URL('../data/pokemon.json',import.meta.url),'utf8'))};
      const result=await request(handler,url,{method:options.method,body:options.body?JSON.parse(options.body):undefined,cookie});
      if(result.headers['set-cookie'])cookie=result.headers['set-cookie'].split(';')[0];
      return {status:result.status,ok:result.status>=200&&result.status<300,json:async()=>JSON.parse(JSON.stringify(result.body))};
    },
    crypto:{randomUUID},setTimeout:()=>1,clearTimeout(){},matchMedia:()=>({matches:reducedMotion}),
    FormData:class{constructor(target){this.fields=target.fields;}get(key){return this.fields[key]??'';}},
  });
  runInContext(await readFile(new URL('../app.js',import.meta.url),'utf8'),context);
  await runInContext('initialize().catch(()=>{})',context);assert(classes.has('signed-out'));
  node('#login-name').value='shar';node('#password').value='a sufficiently long test password';
  await node('#login-form').onsubmit({preventDefault(){}});
  assert(!classes.has('signed-out'));assert.equal(node('#account-name').textContent,'Sharlotte');assert.equal(node('#password').value,'');
  runInContext('openCreate()',context);
  await node('#task-form').onsubmit({preventDefault(){},target:{fields:{title:'Write a test',description:'A small step',steps:'Run the harness',owner:'ours',assigneeId:'ale',status:'ready',companion:'252',priority:'Low',due:'',minutes:'15'}}});
  assert.equal(runInContext('tasks.length',context),1);
  const stored=(await db.collection('tasks').find({}).toArray())[0];assert.equal(stored.ownerId,'sharlotte');assert.equal(stored.visibility,'shared');
  await node('#refresh').onclick();assert.equal(runInContext('tasks.length',context),1);
  // Form is derived from status; the base species remains the persisted value.
  for(const [base,middle,final] of [[4,'Charmeleon','Charizard'],[1,'Ivysaur','Venusaur'],[252,'Grovyle','Sceptile'],[7,'Wartortle','Blastoise']]) {
    assert.equal(runInContext(`companionFor({companion:${base},status:'progress'}).name`,context),middle);
    assert.equal(runInContext(`companionFor({companion:${base},status:'done'}).name`,context),final);
    assert.equal(runInContext(`companionFor({companion:${base},status:'encounter'}).id`,context),base);
  }
  assert.equal(runInContext("companionFor({companion:25,status:'progress'}).name",context),'Pikachu');
  assert.equal(runInContext("companionFor({companion:25,status:'done'}).name",context),'Raichu');
  const drag=node('test-card'), column=node('test-column');
  drag.dataset.taskId=stored._id;column.dataset.status='progress';dragCards.push(drag);dropColumns.push(column);
  runInContext('bindDragAndDrop()',context);
  const transfer=new Map(), dataTransfer={setData:(key,value)=>transfer.set(key,value),getData:key=>transfer.get(key)};
  let prevented=false;
  drag.ondragstart({dataTransfer,preventDefault(){throw new Error('Valid drag rejected');}});
  column.ondragover({dataTransfer,preventDefault(){prevented=true;}});assert(prevented);
  await column.ondrop({dataTransfer,preventDefault(){}});
  assert.equal((await db.collection('tasks').findOne({_id:stored._id})).status,'progress');
  assert.equal((await db.collection('tasks').findOne({_id:stored._id})).companion,252);
  assert.equal(runInContext('companionFor(tasks[0]).name',context),'Grovyle');
  const version=runInContext('tasks[0].version',context);
  await runInContext("changeTaskStatus(tasks[0].id,'progress')",context);
  assert.equal(runInContext('tasks[0].version',context),version);
  // An external or mismatched drag cannot alter tasks.
  column.dataset.status='done';
  await column.ondrop({dataTransfer:{getData:()=>stored._id},preventDefault(){}});
  assert.equal(runInContext('tasks[0].status',context),'progress');
  // Stale moves reload the saved state rather than showing a false evolution.
  await db.collection('tasks').updateOne({_id:stored._id},{$inc:{version:1}});
  assert.equal(await runInContext("changeTaskStatus(tasks[0].id,'done')",context),false);
  assert.equal(runInContext('tasks[0].status',context),'progress');
  runInContext("playEvolution({id:4,name:'Charmander'},{id:5,name:'Charmeleon'},currentUser.id)",context);
  assert.match(node('#toast').textContent,/Charmander → Charmeleon/);
  assert(!node('#evolution-dialog').open);
  reducedMotion=false;
  runInContext("playEvolution({id:4,name:'Charmander'},{id:5,name:'Charmeleon'},currentUser.id)",context);
  assert(node('#evolution-dialog').open);assert.match(node('#evolution-content').innerHTML,/evolution-after/);
  node('#close-evolution').onclick();assert(!node('#evolution-dialog').open);
  // Backward transitions include same-species moves (Ready -> To do).
  assert.equal(runInContext("evolutionTransition({companion:4,status:'done'},{companion:4,status:'progress'}).after.name",context),'Charmeleon');
  assert.equal(runInContext("evolutionTransition({companion:4,status:'progress'},{companion:4,status:'ready'}).direction",context),'backward');
  assert.equal(runInContext("evolutionTransition({companion:4,status:'ready'},{companion:4,status:'encounter'}).after.name",context),'Charmander');
  assert.equal(runInContext("evolutionTransition({companion:4,status:'ready'},{companion:4,status:'ready'})",context),null);
  runInContext("playEvolution({id:6,name:'Charizard'},{id:5,name:'Charmeleon'},currentUser.id,'backward')",context);
  assert.match(node('#evolution-content').innerHTML,/is-devolving/);
  assert.match(node('#evolution-content').innerHTML,/hit-mark/);
  assert.match(node('#evolution-content').innerHTML,/Charizard took a hit!/);
  node('#close-evolution').onclick();
  reducedMotion=true;
  runInContext("playEvolution({id:6,name:'Charizard'},{id:5,name:'Charmeleon'},currentUser.id,'backward')",context);
  assert(!node('#evolution-dialog').open);assert.match(node('#toast').textContent,/Charizard → Charmeleon/);
  assert(await runInContext("changeTaskStatus(tasks[0].id,'done')",context));
  assert(await runInContext("changeTaskStatus(tasks[0].id,'progress')",context));
  assert.equal((await db.collection('tasks').findOne({_id:stored._id})).status,'progress');
  assert.equal(runInContext('companionFor(tasks[0]).name',context),'Grovyle');
  assert(await runInContext("changeTaskStatus(tasks[0].id,'ready')",context));
  assert.equal(runInContext('companionFor(tasks[0]).name',context),'Treecko');


  runInContext('openFocus(tasks[0].id)',context);
  await node('#complete-step').onclick();assert.equal((await db.collection('tasks').findOne({_id:stored._id})).steps[0].done,true);
  await node('#complete-step').onclick();assert.equal((await db.collection('tasks').findOne({_id:stored._id})).status,'done');
  node('#change-password').onclick();
  node('#current-password').value='a sufficiently long test password';
  node('#new-password').value='a different and long test password';
  node('#confirm-password').value='not the same';
  await node('#password-form').onsubmit({preventDefault(){}});
  assert.equal(node('#password-error').textContent,'New passwords do not match.');
  node('#confirm-password').value='a different and long test password';
  await node('#password-form').onsubmit({preventDefault(){}});
  assert(classes.has('signed-out'));assert.equal(runInContext('tasks.length',context),0);
  assert.equal(node('#login-error').textContent,'Password updated. Sign in again.');
  assert(await verifyPassword('a different and long test password',(await db.collection('users').findOne({_id:'sharlotte'})).passwordHash));
});

test('password change: validates current password, revokes own sessions, preserves partner and tasks', async () => {
  const db=memoryDB(), oldPassword='a sufficiently long test password', newPassword='a different and long test password';
  const hash=await hashPassword(oldPassword);
  for(const id of ['ale','sharlotte'])await db.collection('users').insertOne({_id:id,name:id,passwordHash:hash,starter:252});
  const handler=await createHandler({chooseCompanion:()=>252,db,origin:'http://localhost:4174'});
  const login=async(id,password=oldPassword)=>request(handler,'/api/login',{method:'POST',body:{login:id==='ale'?'alejoeie':'shar',password}});
  const first=await login('ale'), second=await login('ale'), partner=await login('sharlotte');
  const cookie=r=>r.headers['set-cookie'].split(';')[0];
  const change=(body,auth=cookie(first),origin='http://localhost:4174')=>request(handler,'/api/password',{method:'POST',cookie:auth,origin,body});
  const input={currentPassword:oldPassword,newPassword,confirmPassword:newPassword};
  const created=await request(handler,'/api/tasks',{method:'POST',cookie:cookie(first),body:payload()});
  const updated=await change(input);assert.equal(updated.status,200);assert.match(updated.headers['set-cookie'],/Max-Age=0/);
  assert(await db.collection('tasks').findOne({_id:created.body.task.id}));
  // First successful change signs out both Ale sessions.
  for(const session of [first,second])assert.equal((await request(handler,'/api/me',{cookie:cookie(session)})).status,401);
  assert.equal((await request(handler,'/api/me',{cookie:cookie(partner)})).status,200);
  assert.equal((await login('ale',oldPassword)).status,401);
  const fresh=await login('ale',newPassword);assert.equal(fresh.status,200);
  assert.equal((await db.collection('users').findOne({_id:'ale'})).starter,252);
  assert.equal((await db.collection('users').findOne({_id:'sharlotte'})).passwordHash,hash);
  const current={currentPassword:newPassword,newPassword:oldPassword,confirmPassword:oldPassword};
  assert.equal((await change(current,cookie(fresh),'https://evil.example')).status,403);
  assert.equal((await request(handler,'/api/password',{method:'POST',body:current})).status,401);
  assert.equal((await change({...current,currentPassword:'wrong'},cookie(fresh))).status,400);
  assert.equal((await change({...current,confirmPassword:'different'},cookie(fresh))).status,400);
  assert.equal((await change({...current,newPassword:'short',confirmPassword:'short'},cookie(fresh))).status,400);
  assert.equal((await change({...current,newPassword:newPassword,confirmPassword:newPassword},cookie(fresh))).status,400);
  assert.equal((await change(current,cookie(fresh))).status,429);
  assert.equal((await login('ale',newPassword)).status,200);
});
