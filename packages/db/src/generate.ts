import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const dir = mkdtempSync(join(tmpdir(), "btc-schema-"));
try {
  execFileSync(
    "pnpm",
    [
      "exec",
      "drizzle-kit",
      "generate",
      "--dialect",
      "postgresql",
      "--schema",
      "./src/schema.ts",
      "--out",
      dir,
    ],
    { stdio: "inherit" },
  );
  const file = readdirSync(dir).find((name) => name.endsWith(".sql"));
  if (!file) throw new Error("Schema generation failed");
  const tables = [
    "user",
    "session",
    "account",
    "verification",
    "merchant",
    "payment_order",
    "settlement",
    "settlement_item",
  ];
  const sql = readFileSync(join(dir, file), "utf8").replaceAll("--> statement-breakpoint", "");
  writeFileSync(
    new URL("../sql/schema.sql", import.meta.url),
    sql +
      "\n" +
      tables.map((t) => `ALTER TABLE public."${t}" FORCE ROW LEVEL SECURITY;`).join("\n") +
      "\n",
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
