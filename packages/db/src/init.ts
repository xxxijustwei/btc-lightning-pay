import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("Missing DATABASE_ADMIN_URL");
const client = postgres(url, { max: 1 });
try {
  // Applies only migrations not yet recorded in drizzle.__drizzle_migrations, each in a transaction.
  await migrate(drizzle(client), {
    migrationsFolder: new URL("../migrations", import.meta.url).pathname,
  });
  console.info("Database migrated");
} finally {
  await client.end();
}
