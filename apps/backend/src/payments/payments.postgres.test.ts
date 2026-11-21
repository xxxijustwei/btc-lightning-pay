import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { createDatabase } from "@btc-lightning-pay/db/client";
import { sql, type SQL } from "drizzle-orm";
import { Millisats } from "@btc-lightning-pay/api";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, test, vi } from "vite-plus/test";
import { createPaymentStore, transactionRunner } from "./store";
import { createCrediting } from "./crediting";
import { createOrderIntake } from "./intake";
import { createPayoutStore } from "./payout-store";
import { createPayouts } from "./payouts";
import { Wallet } from "./wallet";
import { memoryWallet } from "./wallet-memory";

const findOrder = async (database: ReturnType<typeof createDatabase>["database"], key: string) =>
  (await database.execute(sql`SELECT id FROM payment_order WHERE idempotency_key=${key}`))[0] ??
  null;
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
  const slugs = new Map<string, string>();
  /** Order intake on one connection, with an in-memory wallet and a fixed live quote. */
  const intakeOn = (
    client: ReturnType<typeof createDatabase>,
    options: {
      signal?: AbortSignal;
      wallet?: typeof Wallet.Service;
      quote?: () => Promise<typeof price>;
    } = {},
  ) => {
    const store = createPaymentStore(client.database, options.signal);
    const intake = createOrderIntake({
      transaction: transactionRunner(client.database, options.signal),
      crediting: createCrediting(store, vi.fn()),
      quote: options.quote ?? (async () => price),
      log: vi.fn(),
    });
    const wallet = options.wallet ?? memoryWallet().wallet;
    return (merchantId: string, key: string) =>
      Effect.runPromise(
        intake
          .create(slugs.get(merchantId)!, key, input)
          .pipe(Effect.provideService(Wallet, wallet)),
        { signal: options.signal },
      );
  };
  /** A wallet that holds every invoice back until `gate` resolves. */
  const gated = () => {
    const gate = deferred<void>();
    const base = memoryWallet().wallet;
    const wallet: typeof Wallet.Service = {
      ...base,
      issueInvoice: (request) =>
        Effect.promise(() => gate.promise).pipe(Effect.flatMap(() => base.issueInvoice(request))),
    };
    return { gate, wallet };
  };
  const recipient = "0x1111111111111111111111111111111111111111";
  const payoutsOn = (client: ReturnType<typeof createDatabase>) =>
    createPayouts(createPayoutStore(transactionRunner(client.database)), vi.fn());
  /** A quoted payout of `settlementId` on the first connection, with its wallet. */
  async function quotePayout(settlementId: string) {
    const wallet = memoryWallet();
    const payout = await Effect.runPromise(
      payoutsOn(clients[0])
        .quote(settlementId, { chain: "base", asset: "USDC", address: recipient }, actor)
        .pipe(Effect.provideService(Wallet, wallet.wallet)),
    );
    return { wallet, payout };
  }
  const fixture = async () => {
    const slug = `m${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const { id } = await createPaymentStore(clients[0].database).createMerchant(
      { slug, name: "Test merchant", email: `${slug}@example.com` },
      actor,
    );
    merchantIds.push(id);
    slugs.set(id, slug);
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
      sql`INSERT INTO public."user" (id,name,email,role) VALUES (${actor}, 'Test admin', ${`${actor}@example.com`}, 'admin')`,
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
        await admin.database.execute(sql`DELETE FROM admin_audit`);
        for (const id of merchantIds) {
          await admin.database.execute(sql`DELETE FROM settlement_payout WHERE merchant_id=${id}`);
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

  test("overlapping orders claim a key once and RLS scope resets", async () => {
    const id = await fixture();
    const { gate, wallet } = gated();
    const release = await hold(sql`SELECT id FROM merchant WHERE id=${id} FOR UPDATE`);
    const pending = clients
      .slice(0, 2)
      .map((client) => intakeOn(client, { wallet })(id, "same-order-key-0001"));
    try {
      await blocked(2);
    } finally {
      await release();
    }
    // The second request is refused while the first one's invoice is still being issued.
    const refused = await Promise.race(
      pending.map((order) =>
        order.then(
          () => null,
          (e) => e,
        ),
      ),
    );
    expect(refused).toMatchObject({ code: "ORDER_IN_PROGRESS" });
    gate.resolve();
    const results = await Promise.allSettled(pending);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const client of clients.slice(0, 2)) {
      expect(await client.database.execute(sql`SELECT id FROM payment_order`)).toHaveLength(0);
    }
  });

  test("overlapping settlements cannot both claim the same paid order", async () => {
    const id = await fixture();
    const store = createPaymentStore(clients[0].database);
    const order = await intakeOn(clients[0])(id, "paid-order-key-0001");
    await Effect.runPromise(
      createCrediting(store, vi.fn()).credit({
        orderId: order.id,
        amountSat: order.amountSat,
        invoice: order.invoice,
        paymentHash: order.paymentHash,
        expiresAt: order.expiresAt.toISOString(),
        paidAt: new Date().toISOString(),
        receivedMsat: Millisats.make(10000000),
      }),
    );
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
      const { wallet, payout } = await quotePayout(second.id);
      const payouts = payoutsOn(clients[0]);
      await Effect.runPromise(
        payouts
          .submit(second.id, payout.id, actor)
          .pipe(Effect.provideService(Wallet, wallet.wallet)),
      );
      wallet.setPayout(payout.id, { state: "completed", deliveredOut: "1", externalTx: "0xtx" });
      await Effect.runPromise(payouts.sync().pipe(Effect.provideService(Wallet, wallet.wallet)));
      expect(await store.summary(id)).toMatchObject({ settledSat: size * 10000, unsettledSat: 0 });
    },
    20000,
  );

  test("payout submission and cancel serialize and only one can win", async () => {
    const id = await fixture();
    await seedPaid(id, 1);
    const record = (
      await createPaymentStore(clients[0].database).settle(
        crypto.randomUUID(),
        { merchantId: id },
        actor,
      )
    ).record;
    const { payout } = await quotePayout(record.id);
    const release = await hold(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${"settlement:merchant:" + id},0))`,
    );
    const pending = Promise.allSettled([
      createPayoutStore(transactionRunner(clients[0].database))
        .beginSubmit(record.id, payout.id, actor)
        .then((claim) => {
          if (!claim.claimed) throw new Error("Quote expired");
        }),
      createPaymentStore(clients[1].database).cancelSettlement(record.id, "unpaid", actor),
    ]);
    try {
      await blocked(2);
    } finally {
      await release();
    }
    const results = await pending;
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    // A submission first blocks the cancel; a cancel first ends the settlement and its quote.
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(["PAYOUT_IN_PROGRESS", "SETTLEMENT_STATE_CONFLICT"]).toContain(rejected.reason.code);
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
    const create = intakeOn(clients[0], { signal: controller.signal });
    const release = await hold(sql`SELECT id FROM merchant WHERE id=${id} FOR UPDATE`);
    const cleanup = vi.fn();
    const pending = create(id, "cancelled-order-key")
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
    expect(await findOrder(clients[1].database, "cancelled-order-key")).toBeNull();
    expect(await clients[0].database.execute(sql`SELECT id FROM merchant`)).toHaveLength(0);
  });

  test("waiting for a quote holds no merchant lock and the locked reservation refuses a merchant disabled meanwhile", async () => {
    const id = await fixture();
    const entered = deferred<void>(),
      quote = deferred<typeof price>();
    // The reservation is taken under the merchant lock before invoicing, so no invoice is wasted.
    const wallet = memoryWallet();
    const create = intakeOn(clients[0], {
      wallet: wallet.wallet,
      quote: async () => {
        entered.resolve();
        return quote.promise;
      },
    });
    const pending = create(id, "delayed-quote-key").then(
      () => null,
      (error) => error,
    );
    await entered.promise;
    try {
      const updated = createPaymentStore(clients[1].database).updateMerchant(
        id,
        { enabled: false },
        actor,
      );
      await expect(updated).resolves.toMatchObject({ enabled: false });
    } finally {
      quote.resolve(price);
    }
    expect(await pending).toMatchObject({ code: "MERCHANT_DISABLED" });
    expect(wallet.asked.issueInvoice).toBe(0);
    expect(await findOrder(clients[0].database, "delayed-quote-key")).toBeNull();
  });
  test("concurrent disable requests preserve one enabled admin", async () => {
    const store = createPaymentStore(clients[0].database);
    const a = await store.createAdmin({ name: "Admin A", email: "admin-a@example.com" }, actor);
    const b = await store.createAdmin({ name: "Admin B", email: "admin-b@example.com" }, actor);
    await admin.database.execute(sql`UPDATE public."user" SET banned=true WHERE id=${actor}`);
    const release = await hold(sql`SELECT pg_advisory_xact_lock(1380994389)`);
    const pending = Promise.allSettled([
      createPaymentStore(clients[0].database).updateUser(a.id, true, a.id),
      createPaymentStore(clients[1].database).updateUser(b.id, true, b.id),
    ]);
    try {
      await blocked(2);
    } finally {
      await release();
    }
    try {
      const results = await pending;
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({
        reason: { code: "LAST_ADMIN" },
      });
      const enabled = await admin.database.execute(
        sql`SELECT id FROM public."user" WHERE role='admin' AND banned=false`,
      );
      expect(enabled).toHaveLength(1);
    } finally {
      await admin.database.execute(sql`UPDATE public."user" SET banned=false WHERE id=${actor}`);
    }
  });
  test("disabling waits for an in-flight session insert then revokes it", async () => {
    const store = createPaymentStore(clients[0].database);
    const account = await store.createAdmin(
      { name: "Session admin", email: "session-admin@example.com" },
      actor,
    );
    const token = crypto.randomUUID();
    const release = await hold(
      sql`INSERT INTO session(id,token,user_id,expires_at) VALUES (${token},${token},${account.id},now()+interval '1 hour')`,
    );
    const pending = store.updateUser(account.id, true, actor);
    try {
      await blocked(1);
    } finally {
      await release();
    }
    await pending;
    await expect(
      clients[1].database.execute(
        sql`INSERT INTO session(id,token,user_id,expires_at) VALUES (${token},${token},${account.id},now()+interval '1 hour')`,
      ),
    ).rejects.toThrow();
    await store.updateUser(account.id, false, actor);
    expect(
      await clients[1].database.execute(sql`SELECT id FROM session WHERE user_id=${account.id}`),
    ).toHaveLength(0);
  });
});
