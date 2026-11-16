import { MongoClient } from "mongodb";
export async function connectDatabase(env = process.env) {
  if (!env.MONGODB_URI || env.MONGODB_URI.includes("YOUR_CLUSTER"))
    throw new Error("Set MONGODB_URI in .env.");
  const name = env.MONGODB_DB || "pokedo";
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error("Invalid MONGODB_DB.");
  let uri = env.MONGODB_URI;
  if (env.MONGODB_USERNAME && env.MONGODB_PASSWORD) {
    try {
      const parsed = new URL(uri);
      parsed.username = encodeURIComponent(env.MONGODB_USERNAME);
      parsed.password = encodeURIComponent(env.MONGODB_PASSWORD);
      uri = parsed.toString();
    } catch { throw new Error('Invalid Atlas connection settings.'); }
  }
  const client = new MongoClient(uri, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 10000,
  });
  try {
    await client.connect();
    await client.db(name).command({ ping: 1 });
  } catch {
    await client.close();
    throw new Error(
      "Atlas connection failed. Check local credentials and the Atlas network access list.",
    );
  }
  return { db: client.db(name), close: () => client.close() };
}
