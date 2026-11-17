import { DatabaseSync } from "node:sqlite";
import { GatewayPayment } from "@btc-lightning-pay/api/payments";
import { Schema } from "effect";
const Job = Schema.Struct({
  id: Schema.String,
  amount: Schema.Number,
  result: Schema.NullOr(Schema.String),
  synced: Schema.Number,
});
export function createJobStore(db: DatabaseSync) {
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
  const version = Number(db.prepare("PRAGMA user_version").get()?.user_version);
  if (version > 1) throw new Error("Gateway database is newer than this server");
  if (version === 0)
    db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS invoice_job(id TEXT PRIMARY KEY,amount INTEGER NOT NULL CHECK(amount>0),result TEXT,synced INTEGER NOT NULL DEFAULT 0 CHECK(synced IN (0,1)),next_check INTEGER NOT NULL DEFAULT 0) STRICT;
    CREATE INDEX IF NOT EXISTS job_due ON invoice_job(next_check);
    PRAGMA user_version=1; COMMIT;`);
  return {
    get(id: string) {
      const row = db.prepare("SELECT * FROM invoice_job WHERE id=?").get(id);
      return row ? Schema.decodeUnknownSync(Job)(row) : undefined;
    },
    claim(id: string, amount: number) {
      return (
        db.prepare("INSERT OR IGNORE INTO invoice_job(id,amount) VALUES(?,?)").run(id, amount)
          .changes === 1
      );
    },
    save(value: typeof GatewayPayment.Type) {
      db.prepare("UPDATE invoice_job SET result=?,next_check=? WHERE id=?").run(
        JSON.stringify(value),
        Date.now() + (new Date(value.expiresAt).getTime() < Date.now() ? 3_600_000 : 10_000),
        value.orderId,
      );
    },
    synced(id: string) {
      db.prepare("UPDATE invoice_job SET synced=1,next_check=9223372036854775807 WHERE id=?").run(
        id,
      );
    },
    wake(id: string) {
      db.prepare("UPDATE invoice_job SET next_check=0 WHERE id=? AND synced=0").run(id);
    },
    due() {
      return db
        .prepare("SELECT id FROM invoice_job WHERE next_check<=? ORDER BY next_check LIMIT 100")
        .all(Date.now())
        .map((row) => String(row.id));
    },
    defer(id: string) {
      db.prepare("UPDATE invoice_job SET next_check=? WHERE id=? AND synced=0").run(
        Date.now() + 60_000,
        id,
      );
    },
  };
}
