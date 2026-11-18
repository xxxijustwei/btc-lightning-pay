import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { createDatabase } from "@btc-lightning-pay/db/client";
import { sql, type SQL } from "drizzle-orm";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, test, vi } from "vite-plus/test";
import { createPaymentStore } from "./store";
import { createPaymentService } from "./service";
import { paymentTask } from "./runtime";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const url = process.env.PAYMENT_TEST_DATABASE_URL;
// Explicit opt-in: this suite provisions roles and must only target a disposable local database.
if (url) {
  const target = new URL(url);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
    target.pathname !== "/payments_test"
  )
    throw new Error(
      "PAYMENT_TEST_DATABASE_URL must target a disposable local payments_test database",
    );
}

describe.skipIf(!url)("PostgreSQL multi-connection payment invariants", () => {
  const resources: ReturnType<typeof createDatabase>[] = [];
  const connect = () => {
    const resource = createDatabase(url!);
    resources.push(resource);
    return resource;
  };
  let admin: ReturnType<typeof createDatabase>;
  let clients: ReturnType<typeof createDatabase>[];
  let pids: number[];
  const actor = `test-${crypto.randomUUID()}`;
  const merchantIds: string[] = [];
  const price = { rateUsd: "100000", quotedAt: new Date(), amountSat: 10000 };
  const input = { amountUsdCents: 1000 };
  const fixture = async () => {
    const id = `m${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
    merchantIds.push(id);
    await createPaymentStore(clients[0].database).createMerchant(id);
    return id;
  };
  async function hold(query: SQL) {
    const ready = deferred<void>(),
      release = deferred<void>();
    const done = admin.database.transaction(async (tx) => {
      await tx.execute(query);
      ready.resolve();
      await release.promise;
    });
    void done.catch(ready.reject);
    await ready.promise;
    return async () => {
      release.resolve();
      await done;
    };
  }
  async function blocked(count: number) {
    await vi.waitFor(
      async () => {
        const rows = await clients[2].database.execute(
          sql`SELECT count(*)::int AS count FROM pg_stat_activity WHERE pid IN (${pids[0]}, ${pids[1]}) AND cardinality(pg_blocking_pids(pid)) > 0`,
        );
        expect(rows[0].count).toBe(count);
      },
      { timeout: 5000, interval: 20 },
    );
  }
  beforeAll(async () => {
    admin = connect();
    await admin.database.execute(
      sql.raw(
        readFileSync(new URL("../../../../packages/db/sql/schema.sql", import.meta.url), "utf8"),
      ),
    );
    await admin.database.execute(
      sql.raw(
        readFileSync(
          new URL("../../../../packages/db/sql/provision-backend-role.sql", import.meta.url),
          "utf8",
        ),
      ),
    );
    await admin.database.execute(
      sql`INSERT INTO public."user" (id,name,email) VALUES (${actor}, 'Test admin', ${`${actor}@example.com`})`,
    );
    clients = [connect(), connect(), connect()];
    pids = [];
    for (const client of clients) {
      await client.database.execute(sql`SET ROLE btc_backend`);
      const rows = await client.database.execute(
        sql`SELECT pg_backend_pid() AS pid, current_user AS role`,
      );
      pids.push(Number(rows[0].pid));
      expect(rows[0].role).toBe("btc_backend");
    }
    expect(new Set(pids).size).toBe(3);
  }, 20000);
  afterAll(async () => {
    try {
      if (admin) {
        for (const id of merchantIds) {
          await admin.database.execute(sql`DELETE FROM settlement_item WHERE merchant_id=${id}`);
          await admin.database.execute(sql`DELETE FROM payment_order WHERE merchant_id=${id}`);
          await admin.database.execute(sql`DELETE FROM settlement WHERE merchant_id=${id}`);
          await admin.database.execute(sql`DELETE FROM merchant WHERE id=${id}`);
        }
        await admin.database.execute(sql`DELETE FROM public."user" WHERE id=${actor}`);
      }
    } finally {
      await Promise.all(resources.map((resource) => resource.close()));
    }
  });

  test("overlapping duplicate creation returns one order and RLS scope resets", async () => {
    const id = await fixture();
    const release = await hold(sql`SELECT id FROM merchant WHERE id=${id} FOR UPDATE`);
    const pending = clients
      .slice(0, 2)
      .map((client) =>
        createPaymentStore(client.database).createOrder(id, "same-order-key-0001", input, price),
      );
    try {
      await blocked(2);
    } finally {
      await release();
    }
    const [a, b] = await Promise.all(pending);
    expect(a.id).toBe(b.id);
    for (const client of clients.slice(0, 2)) {
      expect(await client.database.execute(sql`SELECT id FROM payment_order`)).toHaveLength(0);
    }
  });

  test("concurrent invoice attachment creates once and never replaces the saved invoice", async () => {
    const merchantId = await fixture();
    const store = createPaymentStore(clients[0].database);
    const order = await store.createOrder(merchantId, "attach-order-key", input, price);
    const release = await hold(sql`SELECT id FROM payment_order WHERE id=${order.id} FOR UPDATE`);
    const create = vi.fn(async () => ({
      orderId: order.id,
      amountSat: 10000,
      invoice: "lnbc100u1test",
      paymentHash: order.id.replaceAll("-", "").repeat(2),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      paidAt: null,
      receivedMsat: null,
    }));
    const pending = clients
      .slice(0, 2)
      .map((client) => createPaymentStore(client.database).attachInvoice(order.id, create));
    try {
      await blocked(2);
    } finally {
      await release();
    }
    const [a, b] = await Promise.all(pending);
    expect(a.paymentHash).toBe(b.paymentHash);
    expect(create).toHaveBeenCalledOnce();
    await store.attachInvoice(order.id, create);
    expect(create).toHaveBeenCalledOnce();
  });

  test("overlapping settlements cannot both claim the same paid order", async () => {
    const id = await fixture();
    const store = createPaymentStore(clients[0].database);
    const order = await store.createOrder(id, "paid-order-key-0001", input, price);
    await store.sync({
      orderId: order.id,
      amountSat: 10000,
      invoice: "lnbc100u1test",
      paymentHash: order.id.replaceAll("-", "").repeat(2),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      paidAt: new Date().toISOString(),
      receivedMsat: 10000000,
    });
    const release = await hold(sql`SELECT id FROM payment_order WHERE id=${order.id} FOR UPDATE`);
    const pending = Promise.allSettled(
      clients
        .slice(0, 2)
        .map((client, i) =>
          createPaymentStore(client.database).settle(
            `settlement-${crypto.randomUUID()}-${i}`,
            { merchantId: id },
            actor,
          ),
        ),
    );
    try {
      await blocked(2);
    } finally {
      await release();
    }
    const results = await pending;
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "NO_ELIGIBLE_ORDERS" },
    });
    expect(await store.summary(id)).toMatchObject({
      settledSat: 0,
      pendingSettlementSat: 10000,
      unsettledSat: 10000,
    });
  });

  async function seedPaid(id: string, size: number) {
    await admin.database
      .execute(sql`WITH ids AS (SELECT gen_random_uuid() AS id, n FROM generate_series(1,${size}::int) n)
      INSERT INTO payment_order(id,merchant_id,idempotency_key,amount_usd_cents,amount_sat,rate_usd,quoted_at,status,invoice,payment_hash,expires_at,paid_at,received_msat)
      SELECT id,${id},'seed-'||n,1000,10000,'100000',now(),'paid','lnbc100u1test',md5(id::text)||md5(id::text),now()+interval '1 hour',now(),10000000 FROM ids`);
  }
  test.each([5000, 10000])(
    "a %i-order batch has an exact fixed total and paginated history",
    async (size) => {
      const id = await fixture();
      await seedPaid(id, size);
      const store = createPaymentStore(clients[0].database);
      const started = performance.now();
      const { record } = await store.settle(crypto.randomUUID(), { merchantId: id }, actor);
      const durationMs = Math.round(performance.now() - started);
      console.info(JSON.stringify({ event: "settlement_capacity_test", orders: size, durationMs }));
      expect(record).toMatchObject({
        orderCount: size,
        amountSat: size * 10000,
        status: "pending",
      });
      const first = await store.settlementOrders(record.id, 100, 0),
        last = await store.settlementOrders(record.id, 100, size - 100);
      expect(first.items).toHaveLength(100);
      expect(last.items).toHaveLength(100);
      expect(last.total).toBe(size);
      expect(first.items[0].orderId).not.toBe(last.items[0].orderId);
      await store.cancelSettlement(record.id, "not paid", actor);
      expect((await store.settlementOrders(record.id, 100, size - 100)).items).toEqual(last.items);
      expect(await store.summary(id)).toMatchObject({
        availableSettlementSat: size * 10000,
        pendingSettlementSat: 0,
      });
      const second = (await store.settle(crypto.randomUUID(), { merchantId: id }, actor)).record;
      await store.confirmSettlement(second.id, "wire-proof", actor);
      expect(await store.summary(id)).toMatchObject({ settledSat: size * 10000, unsettledSat: 0 });
    },
    20000,
  );

  test("confirm and cancel serialize and only one can win", async () => {
    const id = await fixture();
    await seedPaid(id, 1);
    const record = (
      await createPaymentStore(clients[0].database).settle(
        crypto.randomUUID(),
        { merchantId: id },
        actor,
      )
    ).record;
    const release = await hold(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${"settlement:merchant:" + id},0))`,
    );
    const pending = Promise.allSettled([
      createPaymentStore(clients[0].database).confirmSettlement(record.id, "wire", actor),
      createPaymentStore(clients[1].database).cancelSettlement(record.id, "unpaid", actor),
    ]);
    try {
      await blocked(2);
    } finally {
      await release();
    }
    const results = await pending;
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "SETTLEMENT_STATE_CONFLICT" },
    });
  });

  test("cancelled generation rolls back both batch and order reservation", async () => {
    const id = await fixture();
    await seedPaid(id, 1);
    const controller = new AbortController();
    const store = createPaymentStore(clients[0].database, controller.signal);
    const release = await hold(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${"settlement:merchant:" + id},0))`,
    );
    const pending = store.settle(crypto.randomUUID(), { merchantId: id }, actor).then(
      () => false,
      () => true,
    );
    try {
      await blocked(1);
      controller.abort();
    } finally {
      await release();
    }
    expect(await pending).toBe(true);
    const remaining = createPaymentStore(clients[1].database);
    expect((await remaining.settlements({ merchantId: id }, 50, 0)).total).toBe(0);
    expect(await remaining.summary(id)).toMatchObject({
      availableSettlementSat: 10000,
      pendingSettlementSat: 0,
    });
  });

  test("cancellation drains the transaction rollback before connection cleanup", async () => {
    const id = await fixture();
    const controller = new AbortController();
    const store = createPaymentStore(clients[0].database, controller.signal);
    const release = await hold(sql`SELECT id FROM merchant WHERE id=${id} FOR UPDATE`);
    const cleanup = vi.fn();
    const pending = Effect.runPromise(
      paymentTask("create_order", () => store.createOrder(id, "cancelled-order-key", input, price)),
      { signal: controller.signal },
    )
      .then(
        () => "completed",
        () => "cancelled",
      )
      .finally(cleanup);
    try {
      await blocked(1);
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(cleanup).not.toHaveBeenCalled();
    } finally {
      await release();
    }
    expect(await pending).toBe("cancelled");
    expect(cleanup).toHaveBeenCalledOnce();
    expect(
      await createPaymentStore(clients[1].database).findOrder(id, "cancelled-order-key"),
    ).toBeNull();
    expect(await clients[0].database.execute(sql`SELECT id FROM merchant`)).toHaveLength(0);
  });

  test("waiting for a quote holds no merchant lock and admission rechecks disabled merchants", async () => {
    const id = await fixture();
    const entered = deferred<void>(),
      quote = deferred<typeof price>();
    const wallet = vi.fn(async () => null);
    const service = createPaymentService(
      createPaymentStore(clients[0].database),
      async () => {
        entered.resolve();
        return quote.promise;
      },
      wallet,
      vi.fn(),
    );
    const pending = Effect.runPromise(service.createOrder(id, "delayed-quote-key", input)).then(
      () => null,
      (error) => error,
    );
    await entered.promise;
    try {
      const updated = createPaymentStore(clients[1].database).updateMerchant(id, false);
      await expect(updated).resolves.toMatchObject({ enabled: false });
    } finally {
      quote.resolve(price);
    }
    expect(await pending).toMatchObject({ code: "MERCHANT_DISABLED" });
    expect(wallet).not.toHaveBeenCalled();
  });
});
