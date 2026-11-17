import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vite-plus/test";

test("removing rate limits from an existing database preserves auth data and can be migrated again", async () => {
  const folder = fileURLToPath(new NodeURL("../../../../packages/db/drizzle", import.meta.url));
  const previous = mkdtempSync(join(tmpdir(), "btc-auth-migration-"));
  const pg = new PGlite();
  try {
    const journal = JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8"));
    const migrationCount = journal.entries.length;
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 2);
    mkdirSync(join(previous, "meta"));
    writeFileSync(join(previous, "meta/_journal.json"), JSON.stringify(journal));
    for (const entry of journal.entries) {
      copyFileSync(join(folder, `${entry.tag}.sql`), join(previous, `${entry.tag}.sql`));
    }
    const database = drizzle(pg);
    const options = {
      migrationsSchema: "public",
      migrationsTable: "__btc_lightning_pay_migrations",
    };
    await migrate(database, { ...options, migrationsFolder: previous });
    await pg.exec(`
      INSERT INTO public.rate_limit VALUES ('limit', 'test-ip', 1, 1);
      INSERT INTO public."user" (id, name, email) VALUES ('user', 'Test', 'user@example.com');
      INSERT INTO public.session (id, token, user_id, expires_at)
        VALUES ('session', 'token', 'user', now() + interval '1 day');
      INSERT INTO public.account (id, account_id, provider_id, user_id)
        VALUES ('account', 'user', 'test', 'user');
      INSERT INTO public.verification (id, identifier, value, expires_at)
        VALUES ('otp', 'user@example.com', 'hashed-code', now() + interval '5 minutes');
    `);
    const tables = ["user", "session", "account", "verification"];
    const before = await Promise.all(
      tables.map((table) => pg.query(`SELECT * FROM public."${table}"`)),
    );
    await migrate(database, { ...options, migrationsFolder: folder });
    const removed = await pg.query<{ table: string | null }>(
      "SELECT to_regclass('public.rate_limit')::text AS table",
    );
    expect(removed.rows[0].table).toBeNull();
    const after = await Promise.all(
      tables.map((table) => pg.query(`SELECT * FROM public."${table}"`)),
    );
    expect(after.map((result) => result.rows)).toEqual(before.map((result) => result.rows));
    await migrate(database, { ...options, migrationsFolder: folder });
    const history = await pg.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.__btc_lightning_pay_migrations",
    );
    expect(history.rows[0].count).toBe(migrationCount);
  } finally {
    await pg.close();
    rmSync(previous, { recursive: true, force: true });
  }
});
