import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

if (existsSync(".env")) process.loadEnvFile(".env");
const url = process.env.DATABASE_MIGRATION_URL;
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  schemaFilter: ["public"],
  migrations: { schema: "public", table: "__btc_lightning_pay_migrations" },
  ...(url ? { dbCredentials: { url } } : {}),
  strict: true,
});
