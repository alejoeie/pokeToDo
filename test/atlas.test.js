import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { initializeSchema } from "../server/schema.js";
import { hashPassword } from "../server/security.js";
// Opt in: MONGODB_TEST_URI='...' npm test (set privately, not in shell history).
// Creates and drops ONLY a generated pokedo_test_<uuid> database, never MONGODB_DB.
test(
  "Atlas collection validators and indexes (opt-in isolated database)",
  { skip: !process.env.MONGODB_TEST_URI },
  async () => {
    const client = new MongoClient(process.env.MONGODB_TEST_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    const name = `pokedo_test_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    try {
      await client.connect();
      const db = client.db(name);
      await initializeSchema(db);
      await initializeSchema(db);
      const date = new Date(),
        passwordHash = await hashPassword("a sufficiently long test password");
      await db
        .collection("users")
        .insertOne({
          _id: "ale",
          name: "Ale",
          passwordHash,
          starter: null,
          createdAt: date,
          updatedAt: date,
        });
      await assert.rejects(
        db
          .collection("users")
          .insertOne({
            _id: "third",
            name: "X",
            passwordHash,
            starter: null,
            createdAt: date,
            updatedAt: date,
          }),
        (e) => e.code === 121,
      );
      await assert.rejects(
        db
          .collection("users")
          .updateOne({ _id: "ale" }, { $set: { starter: 7 } }),
        (e) => e.code === 121,
      );
      const item = {
        _id: randomUUID(),
        ownerId: "ale",
        visibility: "personal",
        assigneeId: null,
        title: "Test",
        description: "",
        status: "ready",
        companion: 252,
        priority: "Low",
        due: "",
        minutes: 10,
        steps: [{ text: "One step", done: false }],
        version: 1,
        createdAt: date,
        updatedAt: date,
      };
      await db.collection("tasks").insertOne(item);
      await assert.rejects(
        db
          .collection("tasks")
          .updateOne({ _id: item._id }, { $set: { ownerId: "third" } }),
        (e) => e.code === 121,
      );
      const indexes = await db.collection("sessions").indexes();
      assert(indexes.some((i) => i.expireAfterSeconds === 0));
    } finally {
      // A unique disposable database is the only cleanup target.
      try {
        await client.db(name).dropDatabase();
      } finally {
        await client.close();
      }
    }
  },
);
