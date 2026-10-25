import "dotenv/config";
import fs from "node:fs/promises";
import { pool } from "../dist/db/pool.js";

try {
  const sql = await fs.readFile(new URL("../migrations/006_document_categories.sql", import.meta.url), "utf8");
  await pool.query(sql);
  console.log("Migration 006 applied successfully.");
} finally {
  await pool.end();
}
