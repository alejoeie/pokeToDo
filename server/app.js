import { randomCompanion } from "./pokemon.js";
import { validateOrigin } from "./config.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  ACCOUNTS,
  LOGIN_IDS,
  STARTERS,
  HttpError,
  taskAccess,
  validateTask,
  taskDTO,
  userDTO,
} from "./domain.js";
import {
  hashPassword,
  verifyPassword,
  validPassword,
  newToken,
  tokenHash,
  readToken,
  sessionCookie,
} from "./security.js";
const root = new URL("../", import.meta.url);
const assets = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/pokemon-catalog.json": ["data/pokemon.json", "application/json; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
};
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || ""))
    throw new HttpError(415, "JSON required.");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32768) throw new HttpError(413, "Request too large.");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString());
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}
export async function createHandler({
  db,
  origin,
  production = false,
  now = () => new Date(),
  chooseCompanion = randomCompanion,
}) {
  validateOrigin(origin,production);
  const dummyHash = await hashPassword(newToken());
  async function user(req) {
    const token = readToken(req.headers.cookie);
    if (!token) throw new HttpError(401, "Please sign in.");
    const session = await db
      .collection("sessions")
      .findOne({ _id: tokenHash(token), expiresAt: { $gt: now() } });
    if (!session) throw new HttpError(401, "Please sign in.");
    const account = await db
      .collection("users")
      .findOne({ _id: session.userId });
    if (!account || !ACCOUNTS.includes(account._id))
      throw new HttpError(401, "Please sign in.");
    return account;
  }
  async function rateLimit(key, limit) {
    const time = now();
    const bucket = Math.floor(time.getTime() / 900000);
    const counter = await db
      .collection("loginAttempts")
      .findOneAndUpdate(
        { _id: `${key}:${bucket}` },
        {
          $inc: { count: 1 },
          $setOnInsert: { expiresAt: new Date((bucket + 1) * 900000) },
        },
        { upsert: true, returnDocument: "after" },
      );
    if (counter.count > limit)
      throw new HttpError(429, "Too many attempts. Try again in 15 minutes.");
  }
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://raw.githubusercontent.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (production)
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    try {
      const url = new URL(req.url, origin),
        path = url.pathname;
      if (!path.startsWith("/api/")) {
        if (!["GET", "HEAD"].includes(req.method) || !assets[path])
          throw new HttpError(404, "Not found.");
        if(path === "/pokemon-catalog.json") res.setHeader("Cache-Control", "public, max-age=3600");
        const [file, type] = assets[path];
        const data = await readFile(new URL(file, root));
        res.writeHead(200, { "Content-Type": type });
        res.end(req.method === "HEAD" ? undefined : data);
        return;
      }
      if (!["GET", "HEAD"].includes(req.method)) {
        if (
          req.headers.origin !== origin ||
          req.headers["x-pokedo-request"] !== "1"
        )
          throw new HttpError(403, "Request origin rejected.");
      }
      if (path === "/api/health" && req.method === "GET") {
        send(res, 200, { ok: true });
        return;
      }
      if (path === "/api/login" && req.method === "POST") {
        const input = await body(req);
        // Do not trust forwarding headers; this server has no proxy trust configuration.
        await rateLimit(
          `ip:${tokenHash(req.socket.remoteAddress || "unknown")}`,
          30,
        );
        const login =
          typeof input.login === "string"
            ? input.login.toLowerCase().trim()
            : "";
        if (
          !Object.hasOwn(LOGIN_IDS, login) ||
          typeof input.password !== "string" ||
          input.password.length > 128
        )
          throw new HttpError(401, "Incorrect login or password.");
        await rateLimit(`user:${LOGIN_IDS[login]}`, 10);
        const account = await db.collection("users").findOne({ _id: LOGIN_IDS[login] });
        const correct = await verifyPassword(
          input.password,
          account?.passwordHash || dummyHash,
        );
        if (!correct || !account)
          throw new HttpError(401, "Incorrect login or password.");
        const token = newToken(),
          old = readToken(req.headers.cookie),
          createdAt = now();
        if (old)
          await db.collection("sessions").deleteOne({ _id: tokenHash(old) });
        await db
          .collection("sessions")
          .insertOne({
            _id: tokenHash(token),
            userId: account._id,
            createdAt,
            expiresAt: new Date(createdAt.getTime() + 604800000),
          });
        const latest = await db.collection('users').findOne({ _id: account._id });
        if (!latest || latest.passwordHash !== account.passwordHash) {
          await db.collection('sessions').deleteOne({ _id: tokenHash(token) });
          throw new HttpError(401, 'Password changed. Please sign in again.');
        }
        res.setHeader("Set-Cookie", sessionCookie(token, production));
        send(res, 200, { user: userDTO(account) });
        return;
      }
      if (path === "/api/logout" && req.method === "POST") {
        const token = readToken(req.headers.cookie);
        if (token)
          await db.collection("sessions").deleteOne({ _id: tokenHash(token) });
        res.setHeader("Set-Cookie", sessionCookie("", production, 0));
        send(res, 200, { ok: true });
        return;
      }
      const account = await user(req);
      if (path === "/api/password" && req.method === "POST") {
        await rateLimit(`password:${account._id}`, 5);
        const input = await body(req);
        const fields = ['currentPassword', 'newPassword', 'confirmPassword'];
        if (Object.keys(input).length !== 3 || !Object.keys(input).every(key => fields.includes(key)))
          throw new HttpError(400, 'Invalid password request.');
        if (typeof input.currentPassword !== 'string' || !input.currentPassword || input.currentPassword.length > 128)
          throw new HttpError(400, 'Enter your current password.');
        if (!validPassword(input.newPassword))
          throw new HttpError(400, 'Use 12–128 characters.');
        if (input.newPassword !== input.confirmPassword)
          throw new HttpError(400, 'New passwords do not match.');
        if (!await verifyPassword(input.currentPassword, account.passwordHash))
          throw new HttpError(400, 'Current password is incorrect.');
        if (input.currentPassword === input.newPassword)
          throw new HttpError(400, 'Choose a different password.');
        const passwordHash = await hashPassword(input.newPassword);
        const changed = await db.collection('users').findOneAndUpdate(
          { _id: account._id, passwordHash: account.passwordHash },
          { $set: { passwordHash, updatedAt: now() } },
          { returnDocument: 'after' },
        );
        if (!changed) throw new HttpError(409, 'Password already changed. Sign in again.');
        await db.collection('sessions').deleteMany({ userId: account._id });
        res.setHeader('Set-Cookie', sessionCookie('', production, 0));
        send(res, 200, { ok: true });
        return;
      }
      if (path === "/api/me" && req.method === "GET") {
        send(res, 200, { user: userDTO(account) });
        return;
      }
      if (path === "/api/me" && req.method === "PATCH") {
        const input = await body(req);
        if (
          Object.keys(input).length !== 1 ||
          !STARTERS.includes(input.starter)
        )
          throw new HttpError(400, "Invalid starter.");
        await db
          .collection("users")
          .updateOne(
            { _id: account._id },
            { $set: { starter: input.starter, updatedAt: now() } },
          );
        send(res, 200, {
          user: userDTO({ ...account, starter: input.starter }),
        });
        return;
      }
      if (path === "/api/tasks" && req.method === "GET") {
        const after = url.searchParams.get("after");
        if (after && !/^[a-f0-9-]{36}$/.test(after))
          throw new HttpError(400, "Invalid cursor.");
        const filter = {
          ...taskAccess(account._id),
          ...(after ? { _id: { $gt: after } } : {}),
        };
        const items = await db
          .collection("tasks")
          .find(filter)
          .sort({ _id: 1 })
          .limit(101)
          .toArray();
        send(res, 200, {
          tasks: items.slice(0, 100).map(taskDTO),
          next: items.length > 100 ? items[99]._id : null,
        });
        return;
      }
      if (path === "/api/tasks" && req.method === "POST") {
        const input = await body(req);
        const task = validateTask({ ...input, companion: chooseCompanion() });
        if (
          task.visibility === "personal" &&
          task.assigneeId !== null &&
          task.assigneeId !== account._id
        )
          throw new HttpError(
            400,
            "Personal tasks can only be assigned to you.",
          );
        const date = now();
        const item = {
          ...task,
          _id: randomUUID(),
          ownerId: account._id,
          version: 1,
          createdAt: date,
          updatedAt: date,
        };
        await db.collection("tasks").insertOne(item);
        send(res, 201, { task: taskDTO(item) });
        return;
      }
      const match = path.match(/^\/api\/tasks\/([a-f0-9-]{36})$/);
      if (match && ["GET", "PATCH", "DELETE"].includes(req.method)) {
        const filter = { _id: match[1], ...taskAccess(account._id) };
        const existing = await db.collection("tasks").findOne(filter);
        if (!existing) throw new HttpError(404, "Task not found.");
        if (req.method === "GET") {
          send(res, 200, { task: taskDTO(existing) });
          return;
        }
        if (req.method === "DELETE") {
          await db.collection("tasks").deleteOne(filter);
          send(res, 200, { ok: true });
          return;
        }
        const input = await body(req),
          task = validateTask(input);
        if(task.companion !== existing.companion)throw new HttpError(400, 'A task keeps its assigned companion.');
        if (!Number.isInteger(input.version) || input.version < 1)
          throw new HttpError(400, "Task version required.");
        if (
          task.visibility !== existing.visibility &&
          existing.ownerId !== account._id
        )
          throw new HttpError(403, "Only the creator can change visibility.");
        if (
          task.visibility === "personal" &&
          task.assigneeId !== null &&
          task.assigneeId !== existing.ownerId
        )
          throw new HttpError(400, "Invalid personal assignee.");
        const result = await db
          .collection("tasks")
          .findOneAndUpdate(
            { ...filter, version: input.version },
            { $set: { ...task, updatedAt: now() }, $inc: { version: 1 } },
            { returnDocument: "after" },
          );
        if (!result)
          throw new HttpError(409, "Task changed. Reload and try again.");
        send(res, 200, { task: taskDTO(result) });
        return;
      }
      throw new HttpError(404, "Not found.");
    } catch (error) {
      // Never expose connection strings, driver errors, password hashes, or stacks.
      if (!res.headersSent)
        send(res, error instanceof HttpError ? error.status : 500, {
          error:
            error instanceof HttpError
              ? error.message
              : "Request failed. Please try again.",
        });
      else res.end();
    }
  };
}
