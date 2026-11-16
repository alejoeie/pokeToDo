import { ACCOUNTS, POKEMON, STARTERS, STATUSES } from "./domain.js";
const date = { bsonType: "date" };
const account = { enum: ACCOUNTS };
const schemas = {
  users: {
    bsonType: "object",
    additionalProperties: false,
    required: [
      "_id",
      "name",
      "passwordHash",
      "starter",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      _id: account,
      name: { bsonType: "string", minLength: 1, maxLength: 80 },
      passwordHash: {
        bsonType: "string",
        pattern: "^scrypt\\$[a-f0-9]{32}\\$[a-f0-9]{128}$",
      },
      starter: { enum: [null, ...STARTERS] },
      createdAt: date,
      updatedAt: date,
    },
  },
  sessions: {
    bsonType: "object",
    additionalProperties: false,
    required: ["_id", "userId", "expiresAt", "createdAt"],
    properties: {
      _id: { bsonType: "string", pattern: "^[a-f0-9]{64}$" },
      userId: account,
      expiresAt: date,
      createdAt: date,
    },
  },
  tasks: {
    bsonType: "object",
    additionalProperties: false,
    required: [
      "_id",
      "ownerId",
      "visibility",
      "assigneeId",
      "title",
      "description",
      "status",
      "companion",
      "priority",
      "due",
      "minutes",
      "steps",
      "version",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      _id: { bsonType: "string", pattern: "^[a-f0-9-]{36}$" },
      ownerId: account,
      visibility: { enum: ["personal", "shared"] },
      assigneeId: { enum: [null, ...ACCOUNTS] },
      title: { bsonType: "string", minLength: 1, maxLength: 120 },
      description: { bsonType: "string", maxLength: 2000 },
      status: { enum: STATUSES },
      companion: { enum: POKEMON },
      priority: { enum: ["Low", "Medium", "High"] },
      due: { bsonType: "string", pattern: "^$|^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
      minutes: { bsonType: ["int", "double"], minimum: 1, maximum: 480 },
      steps: {
        bsonType: "array",
        minItems: 1,
        maxItems: 20,
        items: {
          bsonType: "object",
          additionalProperties: false,
          required: ["text", "done"],
          properties: {
            text: { bsonType: "string", minLength: 1, maxLength: 300 },
            done: { bsonType: "bool" },
          },
        },
      },
      version: { bsonType: ["int", "double"], minimum: 1 },
      createdAt: date,
      updatedAt: date,
    },
  },
  loginAttempts: {
    bsonType: "object",
    additionalProperties: false,
    required: ["_id", "count", "expiresAt"],
    properties: {
      _id: { bsonType: "string" },
      count: { bsonType: ["int", "double"], minimum: 1 },
      expiresAt: date,
    },
  },
};
export async function initializeSchema(db) {
  for (const [name, schema] of Object.entries(schemas)) {
    const options = {
      validator: { $jsonSchema: schema },
      validationLevel: "strict",
      validationAction: "error",
    };
    if (await db.listCollections({ name }).hasNext())
      await db.command({ collMod: name, ...options });
    else await db.createCollection(name, options);
  }
  await db
    .collection("sessions")
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db
    .collection("loginAttempts")
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection("tasks").createIndex({ ownerId: 1, updatedAt: -1 });
  await db.collection("tasks").createIndex({ visibility: 1, updatedAt: -1 });
}
