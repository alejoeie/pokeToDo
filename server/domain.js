export const ACCOUNTS = ["ale", "sharlotte"];
export const STARTERS = [1, 4, 252];
export const POKEMON = [1, 4, 7, 25, 39, 133, 252];
export const STATUSES = ["encounter", "ready", "progress", "done"];
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const taskAccess = (userId) => ({
  $or: [{ ownerId: userId }, { visibility: "shared" }],
});
export const canAccess = (task, userId) =>
  task && (task.ownerId === userId || task.visibility === "shared");
function check(condition, message) {
  if (!condition) throw new HttpError(400, message);
}
export function validateTask(body) {
  check(
    body && typeof body === "object" && !Array.isArray(body),
    "Invalid task.",
  );
  const allowed = [
    "title",
    "description",
    "visibility",
    "assigneeId",
    "status",
    "companion",
    "priority",
    "due",
    "minutes",
    "steps",
    "version",
  ];
  check(
    Object.keys(body).every((key) => allowed.includes(key)),
    "Unexpected task field.",
  );
  check(
    typeof body.title === "string" &&
      body.title.trim().length > 0 &&
      body.title.trim().length <= 120,
    "Title must be 1–120 characters.",
  );
  check(
    typeof body.description === "string" && body.description.length <= 2000,
    "Description is too long.",
  );
  check(
    ["personal", "shared"].includes(body.visibility),
    "Invalid visibility.",
  );
  check(
    body.assigneeId === null || ACCOUNTS.includes(body.assigneeId),
    "Invalid assignee.",
  );
  check(STATUSES.includes(body.status), "Invalid status.");
  check(POKEMON.includes(body.companion), "Invalid companion.");
  check(["Low", "Medium", "High"].includes(body.priority), "Invalid priority.");
  check(
    Number.isInteger(body.minutes) && body.minutes >= 1 && body.minutes <= 480,
    "Minutes must be 1–480.",
  );
  check(typeof body.due === "string", "Invalid due date.");
  if (body.due !== "") {
    const date = new Date(`${body.due}T12:00:00Z`);
    check(
      /^\d{4}-\d{2}-\d{2}$/.test(body.due) &&
        !Number.isNaN(date.valueOf()) &&
        date.toISOString().slice(0, 10) === body.due,
      "Invalid due date.",
    );
  }
  check(
    Array.isArray(body.steps) &&
      body.steps.length >= 1 &&
      body.steps.length <= 20,
    "Add 1–20 steps.",
  );
  check(
    body.steps.every(
      (step) =>
        step &&
        typeof step.text === "string" &&
        step.text.trim().length > 0 &&
        step.text.length <= 300 &&
        typeof step.done === "boolean" &&
        Object.keys(step).every((k) => ["text", "done"].includes(k)),
    ),
    "Invalid checklist.",
  );
  return {
    title: body.title.trim(),
    description: body.description.trim(),
    visibility: body.visibility,
    assigneeId: body.assigneeId,
    status: body.status,
    companion: body.companion,
    priority: body.priority,
    due: body.due,
    minutes: body.minutes,
    steps: body.steps.map((s) => ({ text: s.text.trim(), done: s.done })),
  };
}
export function taskDTO(task) {
  const { _id, ...rest } = task;
  return {
    ...rest,
    id: _id,
    owner: task.visibility === "shared" ? "ours" : task.ownerId,
  };
}
export function userDTO(user) {
  return { id: user._id, name: user.name, starter: user.starter };
}
