import { defineConfig } from "drizzle-kit";

// Migrations are the source of truth for every database; sql/schema.sql is their concatenation.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
});
