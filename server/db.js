import { MongoClient } from "mongodb";
import { StartupError, databaseFailure } from "./config.js";
export async function connectDatabase(env = process.env) {
  if (!env.MONGODB_URI || env.MONGODB_URI.includes("YOUR_CLUSTER"))
    throw new StartupError("MONGODB_URI is missing or a template. Set it in Render Environment or the local .env.");
  const name = env.MONGODB_DB || "pokedo";
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new StartupError("Invalid MONGODB_DB. Use a database name such as pokedo.");
  let uri = env.MONGODB_URI;
  if (env.MONGODB_USERNAME && env.MONGODB_PASSWORD) {
    try {
      const parsed = new URL(uri);
      parsed.username = encodeURIComponent(env.MONGODB_USERNAME);
      parsed.password = encodeURIComponent(env.MONGODB_PASSWORD);
      uri = parsed.toString();
    } catch { throw new StartupError('Invalid Atlas connection settings. Check MONGODB_URI in Render Environment.'); }
  }
  if(!/^mongodb(?:\+srv)?:\/\//.test(uri) || /<(?:db_)?(?:username|password)>/.test(uri))throw new StartupError('MONGODB_URI is invalid or still contains placeholders. Set the real Atlas URI and database credentials in Render Environment.');
  let client;
  try { client=new MongoClient(uri,{maxPoolSize:5,serverSelectionTimeoutMS:10000}); }
  catch {throw new StartupError('Invalid MONGODB_URI. Use the Atlas mongodb+srv connection URI.');}
  try {
    await client.connect();
    await client.db(name).command({ ping: 1 });
  } catch(error) {
    await client.close();
    throw databaseFailure(error);
  }
  return { db: client.db(name), close: () => client.close() };
}
