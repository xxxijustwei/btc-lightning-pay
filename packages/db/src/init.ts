import { readFileSync } from "node:fs";
import postgres from "postgres";
const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("Missing DATABASE_ADMIN_URL");
const db = postgres(url, { max: 1 });
try {
  await db.begin(async (tx) => {
    await tx.unsafe(readFileSync(new URL("../sql/schema.sql", import.meta.url), "utf8"));
  });
  console.info("Database initialized");
} finally {
  await db.end();
}
