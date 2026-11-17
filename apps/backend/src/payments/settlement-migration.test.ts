import { readFileSync, readdirSync } from "node:fs";
import { URL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { expect, test } from "vite-plus/test";

test.each([false, true])(
  "legacy settlement migration preserves history or rejects bad totals (mismatch=%s)",
  async (mismatch) => {
    const pg = new PGlite();
    const dir = new URL("../../../../packages/db/drizzle/", import.meta.url);
    try {
      await pg.exec(
        "CREATE TABLE public.__btc_lightning_pay_migrations(id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)",
      );
      for (const file of readdirSync(dir)
        .filter((name) => /^000[0-5]_.*\.sql$/.test(name))
        .sort()) {
        await pg.exec("BEGIN");
        await pg.exec(readFileSync(new URL(file, dir), "utf8"));
        await pg.exec("COMMIT");
      }
      await pg.exec(`INSERT INTO public."user"(id,name,email) VALUES('legacy-admin','Admin','legacy@example.com');
    INSERT INTO merchant(id) VALUES('legacy');
    INSERT INTO settlement(id,merchant_id,idempotency_key,amount_sat,proof,created_by) VALUES('12345678-1234-4234-8234-123456789abc','legacy','legacy-key',${mismatch ? 10001 : 10000},'original-proof','legacy-admin');
    INSERT INTO payment_order(id,merchant_id,idempotency_key,amount_usd_cents,amount_sat,rate_usd,quoted_at,status,invoice,payment_hash,expires_at,paid_at,received_msat,fee_msat,settlement_id) VALUES('22345678-1234-4234-8234-123456789abc','legacy','order-key',1000,10000,'100000',now(),'paid','lnbc100u1test',repeat('a',64),now(),now(),10000000,0,'12345678-1234-4234-8234-123456789abc');`);
      await pg.exec("BEGIN");
      const migration = readFileSync(new URL("0006_slippery_iron_man.sql", dir), "utf8");
      if (mismatch) {
        await expect(pg.exec(migration)).rejects.toThrow(/history does not reconcile/);
        await pg.exec("ROLLBACK");
        expect((await pg.query("SELECT proof FROM settlement")).rows).toEqual([
          { proof: "original-proof" },
        ]);
        expect(
          (
            await pg.query(
              "SELECT column_name FROM information_schema.columns WHERE table_name='settlement' AND column_name='status'",
            )
          ).rows,
        ).toHaveLength(0);
      } else {
        await pg.exec(migration);
        await pg.exec("COMMIT");
        expect(
          (await pg.query("SELECT status,order_count,cutoff_at,confirmed_by,proof FROM settlement"))
            .rows,
        ).toEqual([
          {
            status: "settled",
            order_count: 1,
            cutoff_at: null,
            confirmed_by: "legacy-admin",
            proof: "original-proof",
          },
        ]);
        expect((await pg.query("SELECT count(*)::int AS count FROM settlement_item")).rows).toEqual(
          [{ count: 1 }],
        );
        await pg.exec(
          readFileSync(
            new URL("../../../../packages/db/sql/provision-backend-role.sql", import.meta.url),
            "utf8",
          ),
        );
        await pg.exec("SET ROLE btc_backend");
        expect((await pg.query("SELECT * FROM settlement_item")).rows).toHaveLength(0);
        await pg.exec("BEGIN; SELECT set_config('app.payment_admin','true',true)");
        expect((await pg.query("SELECT * FROM settlement_item")).rows).toHaveLength(1);
        await expect(pg.exec("DELETE FROM settlement_item")).rejects.toThrow(/permission denied/);
        await pg.exec("ROLLBACK");
        await pg.exec("BEGIN; SELECT set_config('app.payment_admin','true',true)");
        await pg.exec(`INSERT INTO merchant(id) VALUES('other');
        INSERT INTO payment_order(id,merchant_id,idempotency_key,amount_usd_cents,amount_sat,rate_usd,quoted_at) VALUES('32345678-1234-4234-8234-123456789abc','other','cross-order',1000,10000,'100000',now());`);
        await expect(
          pg.exec(
            `INSERT INTO settlement_item(settlement_id,merchant_id,order_id,amount_sat) VALUES('12345678-1234-4234-8234-123456789abc','legacy','32345678-1234-4234-8234-123456789abc',10000)`,
          ),
        ).rejects.toThrow(/settlement_item_order_fk/);
        await pg.exec("ROLLBACK");
        expect((await pg.query("SELECT * FROM settlement_item")).rows).toHaveLength(0);
      }
    } finally {
      await pg.close();
    }
  },
);
