const pokemon = [
  { id: 1, name: "Bulbasaur", type: "GRASS" },
  { id: 4, name: "Charmander", type: "FIRE" },
  { id: 7, name: "Squirtle", type: "WATER" },
  { id: 25, name: "Pikachu", type: "ELECTRIC" },
  { id: 252, name: "Treecko", type: "GRASS" },
  { id: 39, name: "Jigglypuff", type: "FAIRY" },
  { id: 133, name: "Eevee", type: "NORMAL" },
];
// Shared cached metadata; no per-task API calls to PokéAPI.
let pokemonById = new Map();
const evolutionStage = (status) =>
  status === "done" ? 2 : status === "progress" ? 1 : 0;
function evolvedCompanion(task) {
  const base = pokemonById.get(task.companion);
  return (
    pokemonById.get(base?.stages[evolutionStage(task.status)]) ||
    base ||
    pokemon[0]
  );
}
function evolutionTransition(previous, next) {
  const from = columns.findIndex((c) => c.id === previous.status),
    to = columns.findIndex((c) => c.id === next.status);
  if (from === to) return null;
  const before = evolvedCompanion(previous),
    after = evolvedCompanion(next);
  if (to < from) return { before, after, direction: "backward" };
  return before.id !== after.id
    ? { before, after, direction: "forward" }
    : null;
}
let draggedTaskId = null,
  evolutionQueue = [],
  evolutionTimer = null;
function clearDrag() {
  draggedTaskId = null;
  document
    .querySelectorAll(".drop-target, .is-dragging")
    .forEach((node) => node.classList.remove("drop-target", "is-dragging"));
}
async function changeTaskStatus(id, status) {
  const task = tasks.find((t) => t.id === id);
  if (
    saving ||
    !accessible(task) ||
    !columns.some((c) => c.id === status) ||
    task.status === status
  )
    return false;
  task.status = status;
  if (!(await save())) return false;
  if (status === "done") notify("Task complete!");
  return true;
}
function bindDragAndDrop() {
  document.querySelectorAll("[data-task-id]").forEach((card) => {
    card.ondragstart = (event) => {
      const task = tasks.find((t) => t.id === card.dataset.taskId);
      if (saving || !accessible(task) || !event.dataTransfer) {
        event.preventDefault();
        return;
      }
      draggedTaskId = task.id;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-pokedo-task", task.id);
      card.classList.add("is-dragging");
    };
    card.ondragend = clearDrag;
  });
  document.querySelectorAll(".column[data-status]").forEach((column) => {
    column.ondragover = (event) => {
      if (!draggedTaskId || saving) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      column.classList.add("drop-target");
    };
    column.ondragleave = (event) => {
      if (!column.contains(event.relatedTarget))
        column.classList.remove("drop-target");
    };
    column.ondrop = async (event) => {
      event.preventDefault();
      const id = draggedTaskId,
        received = event.dataTransfer?.getData("application/x-pokedo-task");
      clearDrag();
      if (!id || received !== id) return;
      await changeTaskStatus(id, column.dataset.status);
    };
  });
}
function playEvolution(before, after, owner, direction = "forward") {
  if (!currentUser || currentUser.id !== owner) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    notify(
      before.id === after.id
        ? `${after.name} · Ready again`
        : `${before.name} → ${after.name}`,
    );
    return;
  }
  evolutionQueue.push({ before, after, owner, direction });
  if (!$("#evolution-dialog").open) showNextEvolution();
}
function showNextEvolution() {
  const next = evolutionQueue.shift();
  if (!next || !currentUser || currentUser.id !== next.owner) return;
  const { before, after, direction } = next;
  const backward = direction === "backward";
  $("#evolution-content").innerHTML =
    `<p class="eyebrow">${backward ? "TRY AGAIN" : "EVOLUTION"}</p><h2 id="evolution-title">${before.id === after.id ? after.name : `${before.name} → ${after.name}`}</h2><div class="evolution-stage ${backward ? "is-devolving" : ""}" aria-hidden="true">${backward ? '<span class="hit-mark">✹</span>' : ""}<div class="evolution-ring ring-one"></div><div class="evolution-ring ring-two"></div><span class="evolution-star star-one">✦</span><span class="evolution-star star-two">✧</span><span class="evolution-star star-three">✦</span><img class="evolution-before" src="${sprite(before.spriteId || before.id)}" alt="" width="192" height="192" draggable="false"><img class="evolution-after" src="${sprite(after.spriteId || after.id)}" alt="" width="192" height="192" draggable="false"></div><p id="evolution-message" role="status">${backward ? `${before.name} took a hit!` : `${before.name} is evolving…`}</p><button type="button" class="primary" id="close-evolution">Continue</button>`;
  $("#evolution-dialog").showModal();
  $("#close-evolution").onclick = () => $("#evolution-dialog").close();
  clearTimeout(evolutionTimer);
  evolutionTimer = setTimeout(() => {
    if ($("#evolution-dialog").open && $("#evolution-message"))
      $("#evolution-message").textContent = backward
        ? `${after.name} is ready again.`
        : `Hello, ${after.name}!`;
  }, 1700);
}
const columns = [
  { id: "encounter", name: "To do", hint: "No tasks yet." },
  { id: "ready", name: "Ready", hint: "Nothing ready." },
  { id: "progress", name: "In progress", hint: "Nothing in progress." },
  { id: "done", name: "Done", hint: "No completed tasks." },
];
const starterIds = [4, 1, 7, 252];
let starters = {},
  tasks = [],
  persisted = new Map(),
  currentUser = null;
let trainer = "",
  scope = "mine",
  query = "",
  selectedId = null,
  focusId = null,
  saving = false;
const $ = (s) => document.querySelector(s);
const escapeHTML = (v) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const sprite = (id) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
const companionFor = evolvedCompanion;
const dateLabel = (value) => {
  if (!value) return "No due date";
  const date = new Date(value + "T12:00:00");
  return Number.isNaN(date.valueOf())
    ? "No due date"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
function notify(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(() => ($("#toast").hidden = true), 4500);
}
async function api(path, method = "GET", data) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Pokedo-Request": "1" },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  } catch {
    throw new Error("Cannot reach the server. Try again.");
  }
  const result = await response
    .json()
    .catch(() => ({ error: "Start PokéDo with npm start." }));
  if (response.status === 401 && path !== "/login") showLogin();
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}
const taskPayload = (t) => ({
  title: t.title,
  description: t.description,
  visibility: t.owner === "ours" ? "shared" : "personal",
  assigneeId: t.assigneeId ?? null,
  status: t.status,
  ...(t.companion ? { companion: t.companion } : {}),
  priority: t.priority,
  due: t.due,
  minutes: t.minutes,
  steps: t.steps,
  ...(t.version ? { version: t.version } : {}),
});
async function loadTasks() {
  const items = [];
  let after = null;
  do {
    const result = await api(
      `/tasks${after ? `?after=${encodeURIComponent(after)}` : ""}`,
    );
    items.push(...result.tasks);
    after = result.next;
  } while (after);
  tasks = items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  persisted = new Map(tasks.map((t) => [t.id, JSON.stringify(taskPayload(t))]));
}
async function save() {
  if (saving) return false;
  saving = true;
  for (const selector of ["main", "#task-dialog", ".sidebar", ".topbar"])
    document.querySelector(selector).inert = true;
  let failed = false;
  const evolutions = [];
  const savingUser = currentUser?.id;
  try {
    for (const t of tasks) {
      const payload = taskPayload(t);
      if (persisted.get(t.id) === JSON.stringify(payload)) continue;
      const exists = persisted.has(t.id),
        result = await api(
          exists ? `/tasks/${t.id}` : "/tasks",
          exists ? "PATCH" : "POST",
          payload,
        );
      const previous = persisted.has(t.id)
        ? JSON.parse(persisted.get(t.id))
        : null;
      const transition = previous
        ? evolutionTransition(previous, result.task)
        : null;
      if (transition) evolutions.push(transition);
      const oldId = t.id;
      Object.assign(t, result.task);
      if (selectedId === oldId) selectedId = t.id;
      if (focusId === oldId) focusId = t.id;
    }
    persisted = new Map(
      tasks.map((t) => [t.id, JSON.stringify(taskPayload(t))]),
    );
    if (evolutions.length)
      setTimeout(() => {
        for (const { before, after, direction } of evolutions)
          playEvolution(before, after, savingUser, direction);
      }, 0);
    return true;
  } catch (error) {
    failed = true;
    notify(error.message);
    try {
      if (currentUser) await loadTasks();
    } catch {
      tasks = [];
      persisted.clear();
    }
    return false;
  } finally {
    saving = false;
    for (const selector of ["main", "#task-dialog", ".sidebar", ".topbar"])
      document.querySelector(selector).inert = false;
    if (currentUser) render();
    if (failed && document.querySelector("#task-dialog").open)
      document.querySelector("#task-dialog").close();
  }
}
function showLogin() {
  applyStarterTheme(1);
  setFocusMode(false);
  evolutionQueue = [];
  clearTimeout(evolutionTimer);
  clearDrag();
  if ($("#evolution-dialog").open) $("#evolution-dialog").close();
  currentUser = null;
  trainer = "";
  tasks = [];
  starters = {};
  persisted.clear();
  document.body.classList.add("signed-out");
  if (document.querySelector("#task-dialog").open)
    document.querySelector("#task-dialog").close();
  document.querySelector("#board").innerHTML = "";
  document.querySelector("#dialog-content").innerHTML = "";
}
async function startSession(user) {
  currentUser = user;
  trainer = user.id;
  starters = { [trainer]: user.starter };
  scope = "mine";
  query = "";
  document.querySelector("#search").value = "";
  await loadTasks();
  document.querySelector("#account-name").textContent = user.name;
  document.body.classList.remove("signed-out");
  render();
  if (!starters[trainer]) openStarter();
}
function visibleTasks() {
  return tasks
    .filter((t) => t.owner === (scope === "ours" ? "ours" : trainer))
    .filter((t) =>
      (t.title + " " + t.description).toLowerCase().includes(query),
    );
}
function accessible(t) {
  return t && (t.owner === trainer || t.owner === "ours");
}
function render() {
  renderStarter();
  document.body.dataset.scope = scope;
  const scopeTasks = tasks.filter(
    (t) => t.owner === (scope === "ours" ? "ours" : trainer),
  );
  const doneCount = scopeTasks.filter((t) => t.status === "done").length;
  const percentage = scopeTasks.length
    ? Math.round((doneCount / scopeTasks.length) * 100)
    : 0;
  $("#buddy-progress-label").textContent =
    `${doneCount} of ${scopeTasks.length} tasks done`;
  $("#buddy-progress-bar").setAttribute("aria-valuenow", String(percentage));
  $("#buddy-progress-fill").style.width = `${percentage}%`;
  const visible = visibleTasks();
  document
    .querySelectorAll("[data-scope]")
    .forEach((b) => b.setAttribute("aria-pressed", b.dataset.scope === scope));
  $("#sidebar-name").textContent = currentUser.name;
  $(".avatar").textContent = currentUser.name[0];
  $("#scope-caption").textContent =
    scope === "ours" ? "Shared tasks" : "Personal tasks";
  $("#progress-summary").textContent =
    `${visible.filter((t) => t.status === "done").length} / ${visible.length} done`;
  $("#board").innerHTML = columns
    .map((c) => {
      const items = visible.filter((t) => t.status === c.id);
      return `<section class="column" data-status="${c.id}" aria-label="${c.name}"><div class="column-title"><span class="dot"></span>${c.name}<span class="count">${items.length}</span><button class="column-add" data-create="${c.id}" aria-label="New task in ${c.name}">＋</button></div>${items.map(card).join("")}${items.length ? "" : `<p class="empty-column">${query ? "No matches." : c.hint}</p>`}<button class="add-column" data-create="${c.id}">＋ Add task</button></section>`;
    })
    .join("");
  document
    .querySelectorAll("[data-create]")
    .forEach((b) => (b.onclick = () => openCreate(b.dataset.create)));
  document
    .querySelectorAll("[data-open]")
    .forEach((b) => (b.onclick = () => openDetails(b.dataset.open)));
  document.querySelectorAll("[data-next]").forEach(
    (button) =>
      (button.onclick = () => {
        const task = tasks.find((t) => t.id === button.dataset.next);
        if (!task) return;
        return changeTaskStatus(
          task.id,
          columns[
            Math.min(3, columns.findIndex((c) => c.id === task.status) + 1)
          ].id,
        );
      }),
  );
  bindDragAndDrop();
}
function card(t) {
  const p = companionFor(t),
    done = t.steps.filter((s) => s.done).length,
    percent = t.steps.length ? Math.round((done / t.steps.length) * 100) : 0;
  const next = t.steps.find((s) => !s.done);
  return `<article class="quest-card" draggable="true" data-task-id="${t.id}" aria-label="${escapeHTML(t.title)}; drag to a column or open task to change status"><button class="card-open" data-open="${t.id}" aria-label="Open ${escapeHTML(t.title)}"><div class="pokemon-line"><img src="${sprite(p.spriteId || p.id)}" alt="${p.name}" loading="lazy" width="49" height="49" draggable="false"><div><strong>${p.name}</strong><small>${evolutionStage(t.status) === 0 ? "Base" : t.status === "done" ? "Final form" : "In progress"}</small></div></div><span class="type-badge">${p.type}</span><h3>${escapeHTML(t.title)}</h3><p class="next-step"><strong>Next step</strong><br>${escapeHTML(t.status === "done" ? "Done." : next?.text || "Add a next step.")}</p><div class="card-meta"><span class="priority ${t.priority.toLowerCase()}">${t.priority}</span><span class="priority">◷ ${t.minutes} min</span></div><div class="task-progress" aria-label="${percent}% checklist complete"><span style="width:${percent}%"></span></div></button><div class="card-footer"><span class="${t.due ? "due-date" : ""}">Due ${escapeHTML(dateLabel(t.due))} · ${done}/${t.steps.length}</span>${t.status !== "done" ? `<button class="move-task" data-next="${t.id}">Next →</button>` : "<span>✓ Done</span>"}</div></article>`;
}
function showDialog(html, view = "default") {
  $("#task-dialog").dataset.view = view;
  setFocusMode(view === "focus");
  $("#dialog-content").innerHTML = html;
  $("#task-dialog").showModal();
}
function openCreate(status = "encounter") {
  showDialog(
    `<h2 class="form-title">New task</h2><form id="task-form" class="task-form"><label class="field full">Title<input name="title" required maxlength="120" placeholder="Task name"></label><label class="field full">Description<textarea name="description" maxlength="2000" placeholder="Optional details"></textarea></label><label class="field full">Steps · one per line<textarea name="steps" required maxlength="2000" placeholder="Open the test harness&#10;Reproduce one scenario"></textarea></label><label class="field">Visibility<select name="owner"><option value="${trainer}">Mine</option><option value="ours" ${scope === "ours" ? "selected" : ""}>Ours</option></select></label><label class="field">Assigned to<select name="assigneeId"><option value="">Unassigned</option><option value="ale">Ale</option><option value="sharlotte">Sharlotte</option></select></label><label class="field">Priority<select name="priority"><option>Low</option><option selected>Medium</option><option>High</option></select></label><label class="field">Due date<input type="date" name="due"></label><label class="field">Minutes<input name="minutes" type="number" required min="1" max="480" value="15"></label><label class="field">Status<select name="status">${columns.map((c) => `<option value="${c.id}" ${status === c.id ? "selected" : ""}>${c.name}</option>`).join("")}</select></label><div class="form-actions"><button type="button" class="secondary" id="cancel-create">Cancel</button><button class="primary" type="submit">Create task</button></div></form>`,
  );
  const ownerField = $("#task-form").elements.owner,
    assigneeField = $("#task-form").elements.assigneeId;
  const updateAssignees = () => {
    for (const option of assigneeField.options)
      option.disabled =
        ownerField.value !== "ours" &&
        option.value !== "" &&
        option.value !== trainer;
    if (assigneeField.selectedOptions[0]?.disabled) assigneeField.value = "";
  };
  ownerField.onchange = updateAssignees;
  updateAssignees();
  $("#cancel-create").onclick = () => $("#task-dialog").close();
  $("#task-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      title = String(f.get("title")).trim(),
      steps = String(f.get("steps"))
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20);
    if (!title || !steps.length) {
      notify("Add a title and one step.");
      return;
    }
    const t = {
      id: crypto.randomUUID(),
      title,
      description: String(f.get("description")).trim(),
      owner: String(f.get("owner")),
      assigneeId: f.get("assigneeId") || null,
      status: String(f.get("status")),
      priority: String(f.get("priority")),
      due: String(f.get("due")),
      minutes: Number(f.get("minutes")),
      steps: steps.map((text) => ({ text, done: false })),
    };
    tasks.push(t);
    scope = t.owner === "ours" ? "ours" : "mine";
    query = "";
    $("#search").value = "";
    if (!(await save())) return;
    render();
    $("#task-dialog").close();
    notify(`Task added.`);
  };
}
function openDetails(id) {
  const t = tasks.find((t) => t.id === id);
  if (!accessible(t)) return;
  selectedId = id;
  const p = companionFor(t);
  showDialog(
    `<div class="detail-hero"><img src="${sprite(p.spriteId || p.id)}" alt="${p.name}" width="100" height="100"><div><span class="type-badge">${p.name.toUpperCase()} / ${p.type}</span><h2>${escapeHTML(t.title)}</h2></div></div><p class="detail-description">${escapeHTML(t.description || "No description.")}</p><dl class="detail-stats"><div><dt>PRIORITY</dt><dd>${t.priority}</dd></div><div><dt>DUE DATE</dt><dd>${escapeHTML(dateLabel(t.due))}</dd></div><div><dt>ESTIMATE</dt><dd>${t.minutes} minutes</dd></div></dl><h3 style="font-size:13px">Steps</h3><ul class="checklist">${t.steps.map((s, i) => `<li><label><input type="checkbox" data-step="${i}" ${s.done ? "checked" : ""}>${escapeHTML(s.text)}</label></li>`).join("")}</ul><div class="detail-actions form-actions"><label class="field">Move to<select id="detail-status">${columns.map((c) => `<option value="${c.id}" ${t.status === c.id ? "selected" : ""}>${c.name}</option>`).join("")}</select></label><button class="primary" id="detail-focus">◎ Focus</button></div>`,
  );
  document.querySelectorAll("[data-step]").forEach(
    (input) =>
      (input.onchange = async () => {
        t.steps[Number(input.dataset.step)].done = input.checked;
        if (!(await save())) return;
        render();
      }),
  );
  $("#detail-status").onchange = async (event) => {
    await changeTaskStatus(t.id, event.target.value);
  };
  $("#detail-focus").onclick = () => {
    $("#task-dialog").close();
    openFocus(selectedId);
  };
}
function openFocus(id) {
  const candidates = visibleTasks().filter((t) => t.status !== "done");
  const t = id
    ? tasks.find((t) => t.id === id)
    : candidates.find((t) => t.status === "progress") ||
      candidates.find((t) => t.status === "ready") ||
      candidates[0];
  if (!accessible(t)) {
    notify("No active tasks.");
    return;
  }
  focusId = t.id;
  const next = t.steps.find((s) => !s.done),
    p = companionFor(t);
  showDialog(
    `<div style="text-align:center"><img src="${sprite(p.spriteId || p.id)}" alt="${p.name}" width="96" height="96" style="image-rendering:pixelated"><p class="eyebrow">FOCUS</p><h2>${escapeHTML(t.title)}</h2></div><p class="focus-description">${t.minutes} min estimate</p><div class="focus-step focus-step-content"><p class="eyebrow" style="margin-top:20px">NEXT STEP</p><p class="focus-step">${escapeHTML(next?.text || "All steps done.")}</p></div><button class="primary focus-complete" id="complete-step">${next ? "✓ Done" : "✓ Finish task"}</button>`,
    "focus",
  );
  $("#complete-step").onclick = async () => {
    if (t.status === "done") {
      $("#task-dialog").close();
      return;
    }
    if (next) {
      next.done = true;
      t.status = "progress";
    } else {
      t.status = "done";
    }
    if (!(await save())) return;
    render();
    if (t.status === "done") {
      $("#task-dialog").close();
      notify(`Task complete!`);
    } else {
      $("#task-dialog").close();
      openFocus(focusId);
    }
  };
}

function applyStarterTheme(id) {
  document.body.dataset.starter = String(starterIds.includes(id) ? id : 1);
}
function setFocusMode(active) {
  document.body.dataset.focus = String(active);
  $("#focus-nav").setAttribute("aria-pressed", String(active));
  if (active) {
    $("#focus-nav").classList.add("active");
    $("#board-nav").classList.remove("active");
  } else {
    $("#focus-nav").classList.remove("active");
    $("#board-nav").classList.add("active");
  }
}
function renderStarter() {
  applyStarterTheme(starters[trainer] || 1);
  const chosen = pokemon.find((p) => p.id === starters[trainer]);
  const image = document.querySelector(".welcome-art img");
  image.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${chosen?.id || 1}.png`;
  image.style.opacity = "";
  document.querySelector(".companion-label").textContent = chosen
    ? `${chosen.name.toUpperCase()} / STARTER`
    : "CHOOSE A STARTER";
  document.querySelector("#choose-starter").textContent = chosen
    ? `${chosen.name} · Change`
    : "Choose starter";
}
function openStarter() {
  let selection = starters[trainer] || null;

  showDialog(
    `<div class="starter-intro"><h2>Choose your starter</h2></div><div class="starter-options" role="group" aria-label="Choose a starter Pokémon">${starterIds
      .map((id) => {
        const p = pokemon.find((p) => p.id === id);
        return `<button type="button" class="starter-option starter-${id}" data-starter="${id}" aria-pressed="${selection === id}"><span class="starter-number">#${String(id).padStart(3, "0")}</span><img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png" alt="" width="130" height="130"><strong>${p.name}</strong><span class="type-badge">${p.type}</span><span class="starter-ball" aria-hidden="true">◉</span></button>`;
      })
      .join(
        "",
      )}</div><p class="starter-message" id="starter-message" aria-live="polite">${selection ? `${pokemon.find((p) => p.id === selection).name} selected` : "Pick one."}</p><button type="button" class="primary starter-confirm" id="confirm-starter" ${selection ? "" : "disabled"}>Let’s go →</button><p class="starter-footnote">Change anytime</p>`,
  );
  document.querySelectorAll("[data-starter]").forEach(
    (button) =>
      (button.onclick = () => {
        selection = Number(button.dataset.starter);
        applyStarterTheme(selection);
        document
          .querySelectorAll("[data-starter]")
          .forEach((b) =>
            b.setAttribute(
              "aria-pressed",
              Number(b.dataset.starter) === selection,
            ),
          );
        document.querySelector("#starter-message").textContent =
          `${pokemon.find((p) => p.id === selection).name} selected`;
        document.querySelector("#confirm-starter").disabled = false;
      }),
  );
  document.querySelector("#confirm-starter").onclick = async () => {
    if (!starterIds.includes(selection)) return;
    const button = document.querySelector("#confirm-starter");
    button.disabled = true;
    try {
      const result = await api("/me", "PATCH", { starter: selection });
      currentUser = result.user;
      starters[trainer] = result.user.starter;
    } catch (error) {
      notify(error.message);
      button.disabled = false;
      return;
    }
    renderStarter();
    document.querySelector("#task-dialog").close();
    notify(`${pokemon.find((p) => p.id === selection).name}, I choose you!`);
  };
}

$("#choose-starter").onclick = openStarter;
$("#new-task").onclick = () => openCreate();
document.querySelectorAll("[data-scope]").forEach(
  (b) =>
    (b.onclick = () => {
      scope = b.dataset.scope;
      render();
    }),
);
$("#search").oninput = (e) => {
  query = e.target.value.toLowerCase();
  render();
};
$("#focus-nav").onclick = () => openFocus();
$("#welcome-focus").onclick = () => openFocus();
$("#board-nav").onclick = () => {
  $("#board").scrollIntoView({
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
  });
};
$("#task-dialog").addEventListener("close", () => {
  if (!$("#task-dialog").open) {
    setFocusMode(false);
    if (currentUser) renderStarter();
  }
});
$("#close-dialog").onclick = () => $("#task-dialog").close();
$("#task-dialog").addEventListener("click", (e) => {
  if (e.target === $("#task-dialog")) {
    const r = e.target.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      e.target.close();
  }
});
// Task actions remain available when external sprites cannot load.
document.addEventListener(
  "error",
  (e) => {
    if (e.target instanceof HTMLImageElement) {
      e.target.style.opacity = ".3";
      e.target.alt = e.target.alt || "Companion image unavailable";
    }
  },
  true,
);
$("#evolution-dialog").addEventListener("close", () => {
  clearTimeout(evolutionTimer);
  $("#evolution-content").innerHTML = "";
  if (evolutionQueue.length) showNextEvolution();
});
$("#login-form").onsubmit = async (e) => {
  e.preventDefault();
  const button = $("#login-submit");
  button.disabled = true;
  $("#login-error").textContent = "";
  const password = $("#password").value;
  $("#password").value = "";
  try {
    const result = await api("/login", "POST", {
      login: $("#login-name").value,
      password,
    });
    await startSession(result.user);
  } catch (error) {
    showLogin();
    $("#login-error").textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
$("#refresh").onclick = async () => {
  if (saving) return;
  const button = $("#refresh");
  button.disabled = true;
  saving = true;
  document.querySelector("main").inert = true;
  try {
    await loadTasks();
    render();
  } catch (error) {
    notify(error.message);
  } finally {
    saving = false;
    button.disabled = false;
    document.querySelector("main").inert = false;
  }
};
function openPasswordChange() {
  showDialog(`<h2 class="form-title">Change password</h2>
    <form id="password-form" class="password-form">
      <input type="text" name="username" autocomplete="username" value="${escapeHTML(currentUser.username)}" hidden>
      <label class="field">Current password<input id="current-password" name="currentPassword" type="password" autocomplete="current-password" required maxlength="128"></label>
      <label class="field">New password<input id="new-password" name="newPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128" aria-describedby="password-hint"></label>
      <label class="field">Confirm password<input id="confirm-password" name="confirmPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128"></label>
      <p id="password-hint" class="password-hint">12–128 characters. Signs out all sessions.</p>
      <p id="password-error" class="password-error" role="alert"></p>
      <div class="form-actions"><button type="button" class="secondary" id="cancel-password">Cancel</button><button type="submit" class="primary" id="save-password">Update password</button></div>
    </form>`);
  $("#cancel-password").onclick = () => $("#task-dialog").close();
  $("#password-form").onsubmit = async (event) => {
    event.preventDefault();
    const button = $("#save-password");
    if (button.disabled) return;
    const input = {
      currentPassword: $("#current-password").value,
      newPassword: $("#new-password").value,
      confirmPassword: $("#confirm-password").value,
    };
    $("#password-error").textContent = "";
    if (input.newPassword !== input.confirmPassword) {
      $("#password-error").textContent = "New passwords do not match.";
      return;
    }
    button.disabled = true;
    try {
      await api("/password", "POST", input);
      showLogin();
      $("#login-error").textContent = "Password updated. Sign in again.";
    } catch (error) {
      if (!currentUser) $("#login-error").textContent = error.message;
      else if ($("#password-error"))
        $("#password-error").textContent = error.message;
      else notify(error.message);
      if ($("#current-password")) $("#current-password").value = "";
    } finally {
      button.disabled = false;
    }
  };
}
$("#change-password").onclick = openPasswordChange;
$("#logout").onclick = async () => {
  try {
    await api("/logout", "POST");
    showLogin();
  } catch (error) {
    notify(error.message);
  }
};
showLogin();
async function initialize() {
  const response = await fetch("/pokemon-catalog.json");
  if (!response.ok)
    throw new Error("Cannot load Pokémon. Refresh to try again.");
  const data = await response.json();
  pokemonById = new Map(data.species.map((p) => [p.id, p]));
  const result = await api("/me");
  await startSession(result.user);
}
initialize()
  .catch((error) => {
    showLogin();
    if (error.message !== "Please sign in.")
      $("#login-error").textContent = error.message;
  })
  .finally(() => {
    $("#login-submit").disabled = !pokemonById.size;
  });
