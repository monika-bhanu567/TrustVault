import { buildApp } from "./app.js";
import { PostgresSessionStore } from "./db/postgres-session-store.js";
import { pool } from "./db/pool.js";

const app = buildApp(new PostgresSessionStore());

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

async function startServer() {
  try {
    await app.listen({ port, host });
    console.log(`TrustVault API listening on http://${host}:${port}`);
  } catch (error) {
    console.error("Failed to start TrustVault API:", error);
    await pool.end();
    process.exitCode = 1;
  }
}

async function shutdown() {
  try {
    await app.close();
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

void startServer();
