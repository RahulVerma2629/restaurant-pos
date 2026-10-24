import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pool } from "./pool.js";

async function migrate() {
  const sqlPath = resolve(
    process.cwd(),
    "../database/migrations/001_billing.sql",
  );

  const sql = await readFile(sqlPath, "utf8");

  try {
    await pool.query(sql);
    console.log("✅ Billing database tables created successfully");
  } finally {
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error("❌ Database migration failed:", error);
  process.exitCode = 1;
});