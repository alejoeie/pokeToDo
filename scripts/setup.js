import { connectDatabase } from "../server/db.js";
import { initializeSchema } from "../server/schema.js";
import { hashPassword, validPassword } from "../server/security.js";
import { ACCOUNTS } from "../server/domain.js";
async function passwordPrompt(label) {
  if (!process.stdin.isTTY)
    throw new Error("Run setup in an interactive terminal.");
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => {
      process.stdin.off("data", read);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const read = (chunk) => {
      for (const c of chunk) {
        if (c === "\u0003") {
          finish();
          reject(new Error("Cancelled."));
          return;
        }
        if (c === "\r" || c === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else if (c >= " " && value.length < 129) value += c;
      }
    };
    process.stdin.on("data", read);
  });
}
let connection;
try {
  const reset = process.argv[2] === "--reset" ? process.argv[3] : null;
  if (process.argv.length > 2 && (!reset || !ACCOUNTS.includes(reset)))
    throw new Error("Usage: npm run db:setup [-- --reset ale|sharlotte]");
  connection = await connectDatabase();
  await initializeSchema(connection.db);
  for (const id of reset ? [reset] : ACCOUNTS) {
    const existing = await connection.db
      .collection("users")
      .findOne({ _id: id });
    if (existing && !reset) {
      console.log(`${id}: already exists`);
      continue;
    }
    const name = id === "ale" ? "Ale" : "Sharlotte";
    const password = await passwordPrompt(
      `${name} password (12–128 characters, hidden): `,
    );
    if (!validPassword(password))
      throw new Error("Use 12–128 characters. Run setup again.");
    if (password !== (await passwordPrompt("Confirm password: ")))
      throw new Error("Passwords differ. Run setup again.");
    const passwordHash = await hashPassword(password),
      date = new Date();
    await connection.db
      .collection("users")
      .updateOne(
        { _id: id },
        {
          $set: { name, passwordHash, updatedAt: date },
          $setOnInsert: { starter: null, createdAt: date },
        },
        { upsert: true },
      );
    await connection.db.collection("sessions").deleteMany({ userId: id });
    console.log(`${name}: ready`);
  }
  console.log("Database ready. Run npm start.");
} catch (error) {
  console.error(
    /^(Run setup|Cancelled|Usage:|Use 12|Passwords differ|Set MONGODB|Invalid MONGODB|Atlas connection)/.test(
      error.message,
    )
      ? error.message
      : "Setup failed. Check Atlas permissions and configuration.",
  );
  process.exitCode = 1;
} finally {
  if (connection) await connection.close();
}
