import { createServer } from "node:http";
import { connectDatabase } from "./db.js";
import { createHandler } from "./app.js";
import { StartupError, validateOrigin, startupMessage } from "./config.js";
let connection;
try {
  const port = Number(process.env.PORT || 4174);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new StartupError("Invalid PORT.");
  const production = process.env.NODE_ENV === "production";
  const origin = process.env.APP_ORIGIN || `http://localhost:${port}`;
  validateOrigin(origin,production);
  connection = await connectDatabase();
  const handler = await createHandler({
    db: connection.db,
    origin,
    production,
  });
  const server = createServer(handler);
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on("error", () => {
    console.error("Cannot start server. Check HOST and PORT.");
    void connection.close().then(() => process.exit(1));
  });
  server.listen(port, process.env.HOST || "127.0.0.1", () =>
    console.log(`PokéDo: ${origin}`),
  );
  const stop = () =>
    server.close(() => void connection.close().then(() => process.exit(0)));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (error) {
  console.error(`Startup failed: ${startupMessage(error)}`);
  if (connection) await connection.close();
  process.exitCode = 1;
}
