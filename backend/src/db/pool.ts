
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

export const pool = new Pool(
  connectionString
    ? {
        connectionString,
        ssl: { rejectUnauthorized: false },
        max: 10,
        connectionTimeoutMillis: 10000,
      }
    : {
        host: process.env.DB_HOST ?? "localhost",
        port: Number(process.env.DB_PORT ?? 5432),
        database: process.env.DB_NAME ?? "trustvault",
        user: process.env.DB_USER ?? "postgres",
        password: process.env.DB_PASSWORD,
        max: 10,
        connectionTimeoutMillis: 5000,
      }
);

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error.message);
});
