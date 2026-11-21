import { URL as NodeURL } from "node:url";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Context, Effect, Schema } from "effect";
import { Millisats, PaymentProblem, PublicOrder, Sats, satsToMsat } from "@btc-lightning-pay/api";
import type { Database } from "@btc-lightning-pay/db/client";
import * as schema from "@btc-lightning-pay/db/schema";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vite-plus/test";
import { createPaymentStore, transactionRunner } from "./store";
import { createOrderIntake } from "./intake";
import { publicOrder } from "./projection";
import { createPaymentService } from "./service";
import { createCrediting } from "./crediting";
import { createPayoutStore } from "./payout-store";
import { createPayouts } from "./payouts";
import { UpstreamFailure } from "./errors";
import { makeWallet, parseWalletConfig, Wallet } from "./wallet";
import { memoryWallet, type MemoryWallet } from "./wallet-memory";
import { handlePaymentApp, paymentApp } from "./app";
import { AdminSessions } from "./admin-session";
import { runScheduled, syncPayments } from "./jobs";
import { and, eq, sql } from "drizzle-orm";
import { makeWorker } from "../index";
import { Payments, RequestLog, type Connect } from "../runtime";

const pg = new PGlite();
const database = drizzle(pg, { schema });
const close = vi.fn(async () => {});
// The Worker runs on its real entry points; only the database connection is PGlite.
const connect: Connect = () => ({
  database: database as unknown as ReturnType<Connect>["database"],
  close,
});
const worker = makeWorker(connect);
const store = createPaymentStore(database as unknown as Database);
const quote = vi.fn(async () => ({ rateUsd: "100000", quotedAt: new Date() }));
/** The stored BTC quote, read past row-level security. */
async function storedRate() {
  await pg.exec("RESET ROLE");
  try {
    const { rows } = await pg.query<{ rate_usd: string }>("SELECT rate_usd FROM btc_quote");
    return rows[0]?.rate_usd;
  } finally {
    await pg.exec("SET ROLE payment_app");
  }
}
let onne: string, other: string;
const key = "test-order-key-0001";
// Development: the wallet needs no Cloudflare Access token outside production.
const bindings = { DATABASE_URL: "postgres://local/test", APP_ENV: "development" };
const findOrder = async (merchantId: string, key: string) =>
  (
    await database
      .select()
      .from(schema.paymentOrder)
      .where(and(eq(schema.paymentOrder.merchantId, merchantId), eq(schema.paymentOrder.key, key)))
  )[0] ?? null;
let wallet: MemoryWallet;
const request = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    // Same origin as the test admin sessions below, so admin writes pass the origin check.
    headers: { "content-type": "application/json", origin: "http://localhost", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const log = vi.fn();
const crediting = createCrediting(store, log);
const payments = createPaymentService(store, crediting);
const intake = createOrderIntake({
  transaction: transactionRunner(database as unknown as Database),
  crediting,
  quote,
  log,
});
const payoutStore = createPayoutStore(transactionRunner(database as unknown as Database));
const payouts = createPayouts(payoutStore, log);
const recipient = "0x1111111111111111111111111111111111111111";
/** Runs a payout workflow step against the test's wallet. */
const withWallet = <A, E>(effect: Effect.Effect<A, E, Wallet>) =>
  Effect.runPromise(effect.pipe(Effect.provideService(Wallet, wallet.wallet)));
/** Pays a settlement through the payout flow and returns it as stored afterwards. */
async function paySettlement(settlementId: string, actor = "admin") {
  const payout = await withWallet(
    payouts.quote(settlementId, { chain: "base", asset: "USDC", address: recipient }, actor),
  );
  await withWallet(payouts.submit(settlementId, payout.id, actor));
  wallet.setPayout(payout.id, {
    state: "completed",
    deliveredOut: payout.estimatedOut,
    externalTx: "0xtx",
  });
  await withWallet(payouts.sync());
  return store.settlement(settlementId);
}
/** Credits a receipt as the payment sync does; the result says whether it was an anomaly. */
const credited = (payment: Parameters<typeof crediting.credit>[0]) =>
  Effect.runPromise(crediting.credit(payment));
/** Credits a receipt that must match its order and returns the order as stored now. */
const credit = async (payment: Parameters<typeof crediting.credit>[0]) => {
  const result = await credited(payment);
  if (!("order" in result)) throw new Error(`Unexpected anomaly: ${result.anomaly}`);
  return result.order;
};
const createOrder = (
  merchant: string,
  key: string,
  input: { amountUsdCents: number; reference?: string },
) =>
  // The public API creates orders by slug; tests hold merchant ids.
  Effect.runPromise(
    intake
      .create(merchant === onne ? "onne" : merchant === other ? "other" : merchant, key, input)
      .pipe(Effect.provideService(Wallet, wallet.wallet)),
  );
/** Calls the payments app directly with the given admin sessions. */
const callWith = (req: Request, sessions: Partial<typeof AdminSessions.Service>) =>
  handlePaymentApp(
    req,
    Context.make(Payments, { store, crediting, payments, intake, payouts }).pipe(
      Context.add(RequestLog, { log }),
      Context.add(AdminSessions, {
        origin: "http://localhost",
        log,
        read: async () => ({ actor: null, cookies: [] }),
        ...sessions,
      }),
      Context.add(Wallet, wallet.wallet),
    ),
  );
/** Calls the payments app directly; `actor` is the admin the session check would establish. */
const call = (req: Request, actor?: string) =>
  callWith(req, { read: async () => ({ actor: actor ?? null, cookies: [] }) });
const invoice = (id: string, amountSat = 10000) => ({
  orderId: id,
  amountSat: Sats.make(amountSat),
  invoice: "lnbc100u1test",
  paymentHash: id.replaceAll("-", "").repeat(2),
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  paidAt: null as string | null,
  receivedMsat: null as Millisats | null,
});
const paid = (id: string, amountSat = 10000) => ({
  ...invoice(id, amountSat),
  paidAt: new Date().toISOString(),
  receivedMsat: satsToMsat(Sats.make(amountSat)),
});

beforeAll(async () => {
  await pg.exec(
    readFileSync(new NodeURL("../../../../packages/db/sql/schema.sql", import.meta.url), "utf8"),
  );
  await pg.exec(`CREATE ROLE payment_app NOSUPERUSER NOBYPASSRLS;
    GRANT USAGE ON SCHEMA public TO payment_app;
    GRANT SELECT, INSERT, UPDATE ON merchant, payment_order, settlement, settlement_item TO payment_app;
    INSERT INTO public."user" (id,name,email,role) VALUES ('admin','Admin','admin@example.com','admin');`);
  const provision = readFileSync(
    new NodeURL("../../../../packages/db/sql/provision-backend-role.sql", import.meta.url),
    "utf8",
  );
  await pg.exec(provision);
  await pg.exec(provision);
  await pg.exec("SET ROLE btc_backend;");
  expect((await pg.query('SELECT * FROM public."user"')).rows).toHaveLength(1);
  expect((await pg.query("SELECT * FROM payment_order")).rows).toHaveLength(0);
  await pg.exec("RESET ROLE; GRANT btc_backend TO payment_app;");
});
beforeEach(async () => {
  await pg.exec(
    "RESET ROLE; TRUNCATE admin_audit, settlement_payout, settlement_item, payment_order, settlement, merchant, btc_quote; DELETE FROM public.\"user\" WHERE id <> 'admin'; SET ROLE payment_app;",
  );
  onne = (
    await store.createMerchant({ slug: "onne", name: "Onne", email: "onne@example.com" }, "admin")
  ).id;
  other = (
    await store.createMerchant(
      { slug: "other", name: "Other", email: "other@example.com" },
      "admin",
    )
  ).id;
  quote.mockClear();
  // Creation issues an invoice; a status query finds it still unpaid.
  wallet = memoryWallet();
  close.mockClear();
});
afterAll(async () => {
  await paymentApp.dispose();
  await pg.close();
});

test("idempotency survives repeated requests, conflicts reject and disabled merchants preserve existing orders", async () => {
  const rows = [
    await createOrder(onne, key, { amountUsdCents: 1000 }),
    await createOrder(onne, key, { amountUsdCents: 1000 }),
  ];
  expect(rows[0].id).toBe(rows[1].id);
  expect(quote.mock.calls.length).toBeGreaterThan(0);
  const quoteCalls = quote.mock.calls.length;
  await createOrder(onne, key, { amountUsdCents: 1000 });
  expect(quote).toHaveBeenCalledTimes(quoteCalls);
  await expect(createOrder(onne, key, { amountUsdCents: 1500 })).rejects.toMatchObject({
    code: "IDEMPOTENCY_CONFLICT",
  });
  const otherOrder = await createOrder(other, key, { amountUsdCents: 1000 });
  expect(otherOrder.id).not.toBe(rows[0].id);
  await store.updateMerchant(onne, { enabled: false }, "admin");
  expect((await createOrder(onne, key, { amountUsdCents: 1000 })).id).toBe(rows[0].id);
  await expect(
    createOrder(onne, "new-order-key-0001", { amountUsdCents: 1000 }),
  ).rejects.toMatchObject({ code: "MERCHANT_DISABLED" });
});
test("order creation uses a stored quote and falls back to a live one once it is stale", async () => {
  const fresh = new Date(Date.now() - 4 * 60_000);
  await store.saveQuote({ rateUsd: "50000", quotedAt: fresh });
  const stored = await createOrder(onne, `${key}-stored`, { amountUsdCents: 1000 });
  expect(stored).toMatchObject({ rateUsd: "50000", amountSat: 20000 });
  expect(stored.quotedAt.getTime()).toBe(fresh.getTime());
  expect(quote).not.toHaveBeenCalled();

  // An older quote never replaces a newer one.
  await store.saveQuote({ rateUsd: "1", quotedAt: new Date(fresh.getTime() - 60_000) });
  expect(await storedRate()).toBe("50000");

  await pg.exec(
    "RESET ROLE; UPDATE btc_quote SET quoted_at = now() - interval '11 minutes'; SET ROLE payment_app;",
  );
  const live = await createOrder(onne, `${key}-live`, { amountUsdCents: 1000 });
  expect(live).toMatchObject({ rateUsd: "100000", amountSat: 10000 });
  expect(quote).toHaveBeenCalledOnce();
});
test("the quote cron stores the Coinbase price and only the admin scope may write it", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ data: { amount: "64000.12", currency: "USD" } }));
  // The fifth minute's scheduled run stores a quote; without wallet settings its sync fails alone.
  const quoteRun = () =>
    runScheduled(bindings, Date.UTC(2026, 10, 19, 12, 5), { fetcher, connect });
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await quoteRun();
  } finally {
    info.mockRestore();
  }
  expect(fetcher.mock.calls[0][0]).toBe("https://api.coinbase.com/v2/prices/BTC-USD/spot");
  expect(await storedRate()).toBe("64000.12");
  await expect(
    database.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.payment_admin', 'false', true)`);
      await tx.execute(sql`UPDATE btc_quote SET rate_usd = '1'`);
      return tx.execute(
        sql`INSERT INTO btc_quote (source, rate_usd, quoted_at) VALUES ('coinbase', '1', now())`,
      );
    }),
  ).rejects.toThrow();
  errors.mockClear();
  try {
    fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await quoteRun();
    expect(JSON.parse(String(errors.mock.calls[0][0]))).toMatchObject({
      operation: "refresh_quote",
      dependency: "coinbase",
    });
  } finally {
    errors.mockRestore();
  }
  expect(await storedRate()).toBe("64000.12");
});
test("order creation logs per-step timing without payer data", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    const row = await createOrder(onne, key, { amountUsdCents: 1000, reference: "private note" });
    const entry = JSON.parse(String(info.mock.calls.at(-1)?.[0]));
    expect(entry).toMatchObject({
      event: "order_created",
      orderId: row.id,
      durationMs: expect.any(Number),
      openMs: expect.any(Number),
      quote: "live",
      quoteMs: expect.any(Number),
      invoiceMs: expect.any(Number),
      storeMs: expect.any(Number),
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain("private note");
  } finally {
    info.mockRestore();
  }
});
test("payment updates are monotonic, late payments are credited and net cost is separate from merchant payable", async () => {
  const row = await createOrder(onne, key, { amountUsdCents: 1000 });
  const pending = { ...invoice(row.id), expiresAt: new Date(Date.now() - 1000).toISOString() };
  expect(publicOrder(await credit(pending)).status).toBe("expired");
  const payment = { ...paid(row.id), expiresAt: pending.expiresAt };
  await credit(payment);
  await credit(payment);
  await credit(pending);
  expect(publicOrder(await store.getOrder(row.id)).status).toBe("paid");
  expect(await store.summary(onne)).toMatchObject({
    merchantId: onne,
    paidSat: 10000,
    settledSat: 0,
    unsettledSat: 10000,
  });
  expect(await store.summary(other)).toMatchObject({ paidSat: 0 });
  expect(await credited({ ...payment, receivedMsat: Millisats.make(1) })).toEqual({
    anomaly: "amount_changed",
    orderId: row.id,
  });
});
test("batch lifecycle freezes amounts, reserves orders, retains cancelled history and settles by payout", async () => {
  const a = await createOrder(onne, key, { amountUsdCents: 1000 });
  const b = await createOrder(other, key, { amountUsdCents: 1000 });
  await credit(paid(a.id));
  await credit(paid(b.id));
  const { record } = await store.settle(key, { merchantId: onne }, "admin");
  expect(record).toMatchObject({
    status: "pending",
    amountSat: 10000,
    orderCount: 1,
    createdBy: "admin",
    amountUsdCents: "1000",
    delivered: null,
  });
  expect(await store.summary(onne)).toMatchObject({
    settledSat: 0,
    pendingSettlementSat: 10000,
    availableSettlementSat: 0,
  });
  expect((await store.settle(key, { merchantId: onne }, "admin")).record.id).toBe(record.id);
  await expect(store.settle(key, { merchantId: other }, "admin")).rejects.toMatchObject({
    code: "IDEMPOTENCY_CONFLICT",
  });
  await expect(
    store.settle("other-batch-key", { merchantId: onne }, "admin"),
  ).rejects.toMatchObject({ code: "NO_ELIGIBLE_ORDERS" });
  const later = await createOrder(onne, "later-order-key-0001", { amountUsdCents: 1000 });
  await credit(paid(later.id));
  expect((await store.settlementOrders(record.id, 50, 0)).items).toEqual([
    { orderId: a.id, merchantId: onne, amountSat: 10000, amountUsdCents: 1000 },
  ]);
  expect((await store.settlement(record.id)).amountSat).toBe(10000);
  await store.cancelSettlement(record.id, "not paid", "admin");
  expect((await store.settlementOrders(record.id, 50, 0)).total).toBe(1);
  expect(await store.summary(onne)).toMatchObject({
    availableSettlementSat: 20000,
    pendingSettlementSat: 0,
  });
  await expect(
    withWallet(
      payouts.quote(record.id, { chain: "base", asset: "USDC", address: recipient }, "admin"),
    ),
  ).rejects.toMatchObject({ code: "SETTLEMENT_STATE_CONFLICT" });
  const next = (await store.settle("replacement-batch-key", { merchantId: onne }, "admin")).record;
  expect(next.orderCount).toBe(2);
  const settled = await paySettlement(next.id);
  expect(settled).toMatchObject({
    status: "settled",
    displayStatus: "settled",
    proof: "0xtx",
    confirmedBy: "admin",
    amountUsdCents: "2000",
    delivered: { asset: "USDC", decimals: 6 },
  });
  await expect(store.cancelSettlement(next.id, "oops", "admin")).rejects.toMatchObject({
    code: "SETTLEMENT_STATE_CONFLICT",
  });
  expect(await store.summary(onne)).toMatchObject({
    settledSat: 20000,
    unsettledSat: 0,
    pendingSettlementSat: 0,
    paidUsdCents: 2000,
    settledUsdCents: 2000,
    unsettledUsdCents: 0,
    availableSettlementUsdCents: 0,
  });
  expect(await store.summary(other)).toMatchObject({
    settledSat: 0,
    availableSettlementSat: 10000,
  });
});

test("batch HTTP rejects old bodies, paginates history, and exposes independent settlement status", async () => {
  const row = await createOrder(onne, key, { amountUsdCents: 1000 });
  await credit(paid(row.id));
  const headers = { "idempotency-key": key };
  expect(
    (
      await call(
        request(
          "/api/admin/settlements",
          { merchantId: onne, orderIds: [row.id], amountSat: 10000, proof: "old" },
          headers,
        ),
        "admin",
      )
    ).status,
  ).toBe(400);
  const response = await call(
    request("/api/admin/settlements", { merchantId: onne }, headers),
    "admin",
  );
  expect(response.status).toBe(201);
  const batch = (await response.json()) as { id: string };
  expect(
    (await call(request("/api/admin/settlements", { merchantId: onne }, headers), "admin")).status,
  ).toBe(200);
  expect(await (await call(request(`/api/admin/orders/${row.id}`), "admin")).json()).toMatchObject({
    status: "paid",
    settlementStatus: "pending",
  });
  expect(
    await (await call(request("/api/admin/settlements?limit=1"), "admin")).json(),
  ).toMatchObject({ total: 1, limit: 1, items: [{ id: batch.id, status: "pending" }] });
  expect(
    await (await call(request(`/api/admin/settlements/${batch.id}/orders`), "admin")).json(),
  ).toMatchObject({ total: 1, items: [{ orderId: row.id }] });
  const payoutBody = { chain: "base", asset: "USDC", address: recipient };
  // Without an admin session the middleware answers before any admin endpoint runs.
  expect(
    (await call(request(`/api/admin/settlements/${batch.id}/payouts`, payoutBody))).status,
  ).toBe(401);
  // Manual confirmation is gone: only a payout settles a settlement.
  expect(
    (await call(request(`/api/admin/settlements/${batch.id}/confirm`, { proof: "wire" }), "admin"))
      .status,
  ).toBe(404);
  const quoted = await call(
    request(`/api/admin/settlements/${batch.id}/payouts`, payoutBody),
    "admin",
  );
  expect(quoted.status).toBe(201);
  const payout = (await quoted.json()) as { id: string; status: string; amountSat: number };
  expect(payout).toMatchObject({ status: "quoted", displayStatus: "quoted", amountSat: 10000 });
  const submitted = await call(
    request(`/api/admin/settlements/${batch.id}/payouts/${payout.id}/submit`, {}),
    "admin",
  );
  expect(await submitted.json()).toMatchObject({ status: "pending", submittedBy: "admin" });
  expect(
    await (await call(request(`/api/admin/settlements?limit=1`), "admin")).json(),
  ).toMatchObject({
    items: [{ id: batch.id, status: "pending", displayStatus: "paying", amountUsdCents: 1000 }],
  });
  wallet.setPayout(payout.id, { state: "completed", deliveredOut: "5500000", externalTx: "0xabc" });
  // The detail read asks the wallet about the active payout and settles the batch.
  expect(
    await (await call(request(`/api/admin/settlements/${batch.id}`), "admin")).json(),
  ).toMatchObject({
    status: "settled",
    proof: "0xabc",
    delivered: { asset: "USDC", decimals: 6, deliveredOut: "5500000" },
    payouts: [{ id: payout.id, status: "completed", deliveredOut: "5500000", externalTx: "0xabc" }],
  });
  expect(await (await call(request("/api/admin/wallet"), "admin")).json()).toEqual({
    balanceSat: 10_000_000,
  });
  expect(
    (await (await call(request("/api/admin/payouts/routes"), "admin")).json()) as unknown,
  ).toMatchObject({ routes: [{ chain: "base", asset: "USDC" }] });
  expect((await call(request("/api/admin/quote"), "admin")).status).toBe(503);
});
test("payouts submit once, never resend an unknown outcome, and keep the settlement payable after a failure", async () => {
  const row = await createOrder(onne, key, { amountUsdCents: 1000 });
  await credit(paid(row.id));
  const { record } = await store.settle(key, { merchantId: onne }, "admin");
  const input = { chain: "base", asset: "USDC" as const, address: recipient };
  // A refusal before funds move stores nothing.
  wallet.refuseNext("quotePayout", "AMOUNT_OUT_OF_RANGE");
  await expect(withWallet(payouts.quote(record.id, input, "admin"))).rejects.toMatchObject({
    code: "AMOUNT_OUT_OF_RANGE",
  });
  expect(await payoutStore.payouts(record.id)).toEqual([]);
  // A new quote replaces the open one.
  const first = await withWallet(payouts.quote(record.id, input, "admin"));
  const second = await withWallet(payouts.quote(record.id, input, "admin"));
  expect((await payoutStore.payouts(record.id)).map((p) => [p.id, p.status])).toEqual([
    [second.id, "quoted"],
    [first.id, "expired"],
  ]);
  await expect(withWallet(payouts.submit(record.id, first.id, "admin"))).rejects.toMatchObject({
    code: "PAYOUT_STATE_CONFLICT",
  });
  // The wallet's answer is lost: the payout stays submitting and is never sent again.
  wallet.failNext("sendPayout", "timeout");
  await expect(withWallet(payouts.submit(record.id, second.id, "admin"))).rejects.toMatchObject({
    code: "PAYOUT_OUTCOME_UNKNOWN",
  });
  expect(await payoutStore.payout(second.id)).toMatchObject({ status: "submitting" });
  await expect(withWallet(payouts.submit(record.id, second.id, "admin"))).rejects.toMatchObject({
    code: "PAYOUT_STATE_CONFLICT",
  });
  await expect(withWallet(payouts.quote(record.id, input, "admin"))).rejects.toMatchObject({
    code: "PAYOUT_IN_PROGRESS",
  });
  await expect(store.cancelSettlement(record.id, "stop", "admin")).rejects.toMatchObject({
    code: "PAYOUT_IN_PROGRESS",
  });
  // Too early to call unconfirmed; the sync finds no payment and changes nothing.
  await expect(
    withWallet(payouts.markNotSent(record.id, second.id, "checked", "admin")),
  ).rejects.toMatchObject({ code: "PAYOUT_STATE_CONFLICT" });
  await withWallet(payouts.sync());
  expect(await payoutStore.payout(second.id)).toMatchObject({ status: "submitting" });
  await pg.exec(
    `RESET ROLE; UPDATE settlement_payout SET submitted_at = now() - interval '1 minute' WHERE id = '${second.id}'; SET ROLE payment_app;`,
  );
  expect((await store.settlement(record.id)).displayStatus).toBe("unconfirmed");
  const unsent = await withWallet(
    payouts.markNotSent(record.id, second.id, " provider never saw it ", "admin"),
  );
  expect(unsent).toMatchObject({
    status: "not_sent",
    notSentReason: "provider never saw it",
    resolvedBy: "admin",
  });
  // The settlement is payable again; a refunded payout also leaves it payable.
  const third = await withWallet(payouts.quote(record.id, input, "admin"));
  await withWallet(payouts.submit(record.id, third.id, "admin"));
  wallet.setPayout(third.id, { state: "refunded" });
  await withWallet(payouts.sync());
  expect(await payoutStore.payout(third.id)).toMatchObject({ status: "refunded" });
  expect(await store.settlement(record.id)).toMatchObject({
    status: "pending",
    displayStatus: "pending",
  });
  // A refusal at submission ends the attempt without leaving it active.
  const fourth = await withWallet(payouts.quote(record.id, input, "admin"));
  wallet.refuseNext("sendPayout", "INSUFFICIENT_BALANCE");
  await expect(withWallet(payouts.submit(record.id, fourth.id, "admin"))).rejects.toMatchObject({
    code: "INSUFFICIENT_BALANCE",
  });
  expect(await payoutStore.payout(fourth.id)).toMatchObject({ status: "failed" });
  // An expired quote is recorded as expired and never reaches the wallet.
  const fifth = await withWallet(payouts.quote(record.id, input, "admin"));
  await pg.exec(
    `RESET ROLE; UPDATE settlement_payout SET quote_expires_at = now() - interval '1 second' WHERE id = '${fifth.id}'; SET ROLE payment_app;`,
  );
  const sends = wallet.asked.sendPayout;
  await expect(withWallet(payouts.submit(record.id, fifth.id, "admin"))).rejects.toMatchObject({
    code: "QUOTE_EXPIRED",
  });
  expect(wallet.asked.sendPayout).toBe(sends);
  expect(await payoutStore.payout(fifth.id)).toMatchObject({ status: "expired" });
  // A quoted payout dies with its cancelled settlement.
  const sixth = await withWallet(payouts.quote(record.id, input, "admin"));
  await store.cancelSettlement(record.id, "merchant closed", "admin");
  expect(await payoutStore.payout(sixth.id)).toMatchObject({ status: "expired" });
});
test("real non-owner RLS isolates merchants and public orders and resets on the pooled connection", async () => {
  const a = await createOrder(onne, key, { amountUsdCents: 1000 });
  await createOrder(other, key, { amountUsdCents: 1000 });
  for (const table of ["merchant", "payment_order", "settlement"])
    expect((await pg.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0);
  await pg.exec(`BEGIN; SELECT set_config('app.merchant_id','${onne}',true);`);
  try {
    expect((await pg.query("SELECT * FROM merchant")).rows).toHaveLength(1);
    expect((await pg.query("SELECT * FROM payment_order")).rows).toHaveLength(1);
    await expect(
      pg.exec(
        `INSERT INTO payment_order (id,merchant_id,idempotency_key,amount_usd_cents,amount_sat,rate_usd,quoted_at) VALUES (gen_random_uuid(),'${other}','forged',1000,10000,'100000',now())`,
      ),
    ).rejects.toThrow(/row-level security/);
  } finally {
    await pg.exec("ROLLBACK");
  }
  await pg.exec("BEGIN");
  expect((await pg.query("SELECT * FROM payment_order")).rows).toHaveLength(0);
  await pg.exec("COMMIT");
  expect((await store.getOrder(a.id)).merchantId).toBe(onne);
  await expect(store.getOrder(crypto.randomUUID())).rejects.toMatchObject({
    code: "ORDER_NOT_FOUND",
  });
});
test("public HTTP contracts validate amounts and keep internal data out of responses", async () => {
  const path = "/api/public/merchants/onne/orders";
  expect((await call(request(path, { amountUsdCents: 1000 }))).status).toBe(400);
  expect(
    (await call(request(path, { amountUsdCents: 99 }, { "idempotency-key": key }))).status,
  ).toBe(400);
  expect(quote).not.toHaveBeenCalled();
  const response = await call(
    request(path, { amountUsdCents: 1000, reference: "private" }, { "idempotency-key": key }),
  );
  expect(response.status).toBe(200);
  const raw = await response.json();
  const body = Schema.decodeUnknownSync(PublicOrder)(raw);
  expect(body).toMatchObject({ status: "pending", amountSat: 10000, invoice: "lnbc100u1test" });
  expect(raw).toEqual(body);
  wallet.failNext("issueInvoice", "network");
  const failed = await call(
    request(path, { amountUsdCents: 1000 }, { "idempotency-key": "wallet-down-key-0001" }),
  );
  expect(failed.status).toBe(503);
  expect(await failed.json()).toMatchObject({ code: "WALLET_UNAVAILABLE" });
  wallet.failNext("lookup", "network");
  expect(
    (
      await call(
        request(path, { amountUsdCents: 1000, reference: "private" }, { "idempotency-key": key }),
      )
    ).status,
  ).toBe(200);
  const query = await worker.fetch(request(`/api/public/orders/${body.id}`), bindings);
  expect(query.headers.get("cache-control")).toBe("no-store");
  expect(await query.json()).toMatchObject({ id: body.id });
  expect(close).toHaveBeenCalled();
  expect((await call(request("/api/admin/orders"))).status).toBe(401);
  expect((await call(request("/api/admin/orders"), "admin")).status).toBe(200);
});
test("admin requests pass one seam: auth settings, write origin, session, then the endpoint", async () => {
  const orders = request("/api/admin/orders");
  // Unusable auth settings or a failed session lookup are outages, not anonymous requests.
  for (const sessions of [{ origin: undefined }, { read: async () => "unavailable" as const }]) {
    const response = await callWith(orders, sessions);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "PAYMENTS_UNAVAILABLE",
      message: "Authentication unavailable",
    });
  }
  const read = vi.fn(async () => ({
    actor: "admin",
    cookies: ["btclp.session_token=refreshed; Max-Age=600; Path=/; HttpOnly; SameSite=Lax"],
  }));
  // A write from another origin is refused before the session is read.
  const foreign = request(
    "/api/admin/merchants",
    { name: "N" },
    { origin: "https://evil.example" },
  );
  expect((await callWith(foreign, { read })).status).toBe(403);
  expect(read).not.toHaveBeenCalled();
  // A read needs no origin; the refreshed session cookie goes back with the endpoint's answer.
  const response = await callWith(new Request("http://localhost/api/admin/orders"), { read });
  expect(response.status).toBe(200);
  const [cookie] = response.headers.getSetCookie();
  expect(cookie).toContain("btclp.session_token=refreshed");
  for (const attribute of ["Max-Age=600", "Path=/", "HttpOnly", "SameSite=Lax"])
    expect(cookie.toLowerCase()).toContain(attribute.toLowerCase());
});
test("removed sync endpoint cannot mutate orders", async () => {
  expect((await worker.fetch(request("/api/internal/payments/sync", {}), bindings)).status).toBe(
    404,
  );
});
test("admission bounds per-merchant invoice creation without charging duplicate requests", async () => {
  // Application clock skew must not weaken admission; the database owns this window.
  vi.spyOn(Date, "now").mockReturnValue(Date.now() - 1000);
  try {
    for (let i = 0; i < 5; i++) await createOrder(onne, `${key}-${i}`, { amountUsdCents: 1000 });
    await expect(createOrder(onne, `${key}-6`, { amountUsdCents: 1000 })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    // A refused request never asks the wallet for an invoice.
    expect(wallet.asked.issueInvoice).toBe(5);
    expect((await createOrder(onne, `${key}-0`, { amountUsdCents: 1000 })).amountSat).toBe(10000);
  } finally {
    vi.restoreAllMocks();
  }
});
test("the HTTP wallet refuses redirects and bodies it cannot read", async () => {
  const id = crypto.randomUUID();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://elsewhere.example" } }),
    );
  const issue = (amountSat = 10000) =>
    Effect.runPromise(
      makeWallet(
        parseWalletConfig({
          WALLET_URL: "https://wallet.example",
          WALLET_TOKEN: "g".repeat(32),
          APP_ENV: "development",
        }),
        { fetcher },
      ).issueInvoice({ orderId: id, amountSat: Sats.make(amountSat) }),
    );
  await expect(issue()).rejects.toMatchObject({ reason: "http", upstreamStatus: 302 });
  expect(fetcher.mock.calls[0][1]?.redirect).toBe("manual");
  fetcher.mockResolvedValueOnce(Response.json(null, { status: 202 }));
  await expect(issue()).rejects.toMatchObject({ reason: "invalid_response" });
  fetcher.mockRejectedValueOnce(new TypeError("connection reset"));
  await expect(issue()).rejects.toMatchObject({ reason: "network" });
  fetcher.mockResolvedValueOnce(Response.json(invoice(id)));
  expect(await issue()).toMatchObject({ orderId: id, amountSat: 10000 });
});
test("reads keep the stored order when the Worker has no wallet setting", async () => {
  const row = await createOrder(onne, key, { amountUsdCents: 1000 });
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await worker.fetch(request(`/api/public/orders/${row.id}`), bindings);
    expect(await response.json()).toMatchObject({ id: row.id, status: "pending" });
    expect(JSON.parse(String(errorLog.mock.calls[0][0]))).toMatchObject({
      operation: "refresh_order",
      dependency: "wallet",
      reason: "not_configured",
    });
  } finally {
    errorLog.mockRestore();
  }
});

test.each(["{", JSON.stringify({ amountUsdCents: -1 })])(
  "Worker input failures return a JSON problem and request ID: %s",
  async (body) => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/public/merchants/onne/orders", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": key },
          body,
        }),
        { ...bindings, WALLET_URL: "https://wallet.example", WALLET_TOKEN: "g".repeat(32) },
      );
      expect(response.status).toBe(400);
      expect(Schema.decodeUnknownSync(PaymentProblem)(await response.json())).toEqual({
        code: "INVALID_INPUT",
        message: "INVALID_INPUT",
      });
      expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining(response.headers.get("x-request-id")!),
      );
      expect(quote).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  },
);

test("public order queries record safe upstream context and keep the stored order", async () => {
  const row = await createOrder(onne, key, { amountUsdCents: 1000 });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("sensitive-upstream-response", { status: 502 }))
    .mockResolvedValueOnce(Response.json(invoice(row.id)));
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", fetcher);
  try {
    const env = {
      ...bindings,
      WALLET_URL: "https://wallet.example",
      WALLET_TOKEN: "g".repeat(32),
    };
    await worker.fetch(request(`/api/public/orders/${row.id}`), env);
    expect((await store.getOrder(row.id)).status).toBe("pending");
    const entry = JSON.parse(String(errorLog.mock.calls[0][0]));
    expect(entry).toMatchObject({
      operation: "refresh_order",
      orderId: row.id,
      dependency: "wallet",
      reason: "http",
      upstreamStatus: 502,
      requestId: expect.any(String),
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("sensitive-upstream-response");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(env.WALLET_TOKEN);
    await worker.fetch(request(`/api/public/orders/${row.id}`), env);
    expect((await store.getOrder(row.id)).status).toBe("pending");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1]?.body).toEqual(fetcher.mock.calls[1][1]?.body);
  } finally {
    vi.unstubAllGlobals();
    errorLog.mockRestore();
  }
});

test("concurrent requests invoice a key once and queries never recreate its invoice", async () => {
  const results = await Promise.allSettled([
    createOrder(onne, key, { amountUsdCents: 1000 }),
    createOrder(onne, key, { amountUsdCents: 1000 }),
  ]);
  // The key is reserved before the wallet is asked: one request invoices, the other is told to
  // retry, and the wallet issues exactly one invoice.
  const created = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  for (const r of results)
    if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "ORDER_IN_PROGRESS" });
  expect(created.length).toBeGreaterThan(0);
  expect(wallet.asked.issueInvoice).toBe(1);
  const a = await createOrder(onne, key, { amountUsdCents: 1000 });
  expect(created.every((row) => row.id === a.id)).toBe(true);
  expect(await store.orders({ merchantId: onne }, 10, 0)).toHaveLength(1);
  wallet.pay(a.id);
  // The memory wallet refuses a lookup for any invoice but the one it issued.
  const response = await call(request(`/api/public/orders/${a.id}`));
  expect(await response.json()).toMatchObject({ status: "paid", invoice: a.invoice });
  const lookups = wallet.asked.lookup;
  await call(request(`/api/public/orders/${a.id}`));
  expect(wallet.asked.lookup).toBe(lookups);
});

test.each(["pending", "expired"])(
  "querying a %s invoice records completed payment",
  async (status) => {
    const row = await createOrder(onne, key, { amountUsdCents: 1000 });
    const payment = {
      ...paid(row.id),
      expiresAt: new Date(Date.now() + (status === "expired" ? -1000 : 3600000)).toISOString(),
    };
    await credit({ ...payment, paidAt: null, receivedMsat: null });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payment));
    vi.stubGlobal("fetch", fetcher);
    try {
      const response = await worker.fetch(request(`/api/public/orders/${row.id}`), {
        ...bindings,
        WALLET_URL: "https://wallet.example",
        WALLET_TOKEN: "g".repeat(32),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "paid" });
      expect((await store.getOrder(row.id)).status).toBe("paid");
      expect(String(fetcher.mock.calls[0][0])).toBe("https://wallet.example/v1/payments/query");
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

test("a failed invoice creation stores nothing and the same key can retry", async () => {
  wallet.failNext("issueInvoice", "timeout");
  await expect(createOrder(onne, key, { amountUsdCents: 1000 })).rejects.toMatchObject({
    code: "WALLET_UNAVAILABLE",
  });
  expect(await findOrder(onne, key)).toBeNull();
  wallet.failNext("issueInvoice", "invalid_response");
  await expect(createOrder(onne, key, { amountUsdCents: 1000 })).rejects.toMatchObject({
    code: "WALLET_UNAVAILABLE",
  });
  const retry = await createOrder(onne, key, { amountUsdCents: 1000 });
  expect(retry).toMatchObject({ status: "pending", invoice: "lnbc100u1test" });
  expect(wallet.asked.issueInvoice).toBe(3);
});

test("an invoice that contradicts its reservation is an anomaly and stores nothing", async () => {
  const create = (issuer: typeof Wallet.Service) =>
    Effect.runPromise(
      intake
        .create("onne", key, { amountUsdCents: 1000 })
        .pipe(Effect.provideService(Wallet, issuer)),
    );
  const overcharging = {
    ...wallet.wallet,
    issueInvoice: (request: { orderId: string; amountSat: number }) =>
      wallet.wallet.issueInvoice({ ...request, amountSat: Sats.make(request.amountSat + 1) }),
  };
  log.mockClear();
  await expect(create(overcharging)).rejects.toMatchObject({ code: "WALLET_UNAVAILABLE" });
  expect(await findOrder(onne, key)).toBeNull();
  expect(log).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "payment_anomaly",
      operation: "create_invoice",
      anomaly: "contradicts_order",
    }),
  );
  // An anomaly is not also logged as a failure.
  expect(log.mock.calls.filter(([entry]) => entry.event !== "payment_anomaly")).toHaveLength(0);
  wallet.failNext("issueInvoice", "mismatch");
  await expect(create(wallet.wallet)).rejects.toMatchObject({ code: "WALLET_UNAVAILABLE" });
  expect(log).toHaveBeenLastCalledWith(
    expect.objectContaining({ event: "payment_anomaly", anomaly: "wallet_reported" }),
  );
  expect(await create(wallet.wallet)).toMatchObject({ status: "pending" });
});

test("merchant provisioning is atomic, keeps identity immutable and hides private fields", async () => {
  const payload = { name: "Private merchant name", email: "New@Example.com", slug: "new-shop" };
  const response = await call(request("/api/admin/merchants", payload), "admin");
  expect(response.status).toBe(200);
  const m = (await response.json()) as { id: string; userId: string };
  expect(m.id).not.toBe(payload.slug);
  expect(await store.managedUser(m.userId)).toMatchObject({
    role: "merchant",
    email: "new@example.com",
    banned: false,
    merchantId: m.id,
  });
  expect(await store.adminMerchant(m.id)).toMatchObject({ name: payload.name, slug: payload.slug });
  const publicResponse = await call(request("/api/public/merchants/new-shop"));
  expect(await publicResponse.json()).toEqual({
    merchantId: m.id,
    slug: "new-shop",
    enabled: true,
    currency: "USD",
    minAmountUsdCents: 100,
    maxAmountUsdCents: 30000,
  });
  await expect(
    store.createMerchant({ ...payload, email: "unused@example.com" }, "admin"),
  ).rejects.toMatchObject({ code: "MERCHANT_EXISTS" });
  expect((await store.users(undefined, 100, 0)).some((u) => u.email === "unused@example.com")).toBe(
    false,
  );
  await expect(
    store.createMerchant({ ...payload, slug: "unused-shop" }, "admin"),
  ).rejects.toMatchObject({ code: "EMAIL_EXISTS" });
  for (const body of [
    { slug: "changed" },
    { email: "changed@example.com" },
    { name: "OK", role: "admin" },
    {},
  ]) {
    expect(
      (
        await call(
          new Request(`http://localhost/api/admin/merchants/${m.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json", origin: "http://localhost" },
            body: JSON.stringify(body),
          }),
          "admin",
        )
      ).status,
    ).toBe(400);
  }
  await store.updateMerchant(m.id, { name: "Updated" }, "admin");
  expect(await store.adminMerchant(m.id)).toMatchObject({
    name: "Updated",
    slug: "new-shop",
    email: "new@example.com",
  });
  await expect(
    pg.query("UPDATE public.\"user\" SET role='admin' WHERE id=$1", [m.userId]),
  ).rejects.toThrow(/immutable/);
});

test("only the merchant API disables a merchant; it stops new payments and keeps settlement", async () => {
  const m = await store.adminMerchant(onne);
  const row = await createOrder(onne, key, { amountUsdCents: 1000 });
  // The account endpoint manages admins only; it cannot silently toggle a merchant's checkout.
  await expect(store.updateUser(m.userId, true, "admin")).rejects.toMatchObject({
    code: "USER_IS_MERCHANT",
  });
  expect(await store.adminMerchant(onne)).toMatchObject({ enabled: true });
  await store.updateMerchant(onne, { enabled: false }, "admin");
  expect(await store.adminMerchant(onne)).toMatchObject({ enabled: false });
  expect(await store.managedUser(m.userId)).toMatchObject({ banned: true });
  expect((await pg.query("SELECT id FROM session WHERE user_id=$1", [m.userId])).rows).toHaveLength(
    0,
  );
  expect(await (await call(request("/api/public/merchants/onne"))).json()).toMatchObject({
    enabled: false,
  });
  await expect(
    createOrder(onne, "disabled-new-key", { amountUsdCents: 1000 }),
  ).rejects.toMatchObject({ code: "MERCHANT_DISABLED" });
  await credit(paid(row.id));
  const batch = await store.settle("disabled-merchant-settle", { merchantId: onne }, "admin");
  expect(batch.record.amountSat).toBe(10000);
  await store.updateMerchant(onne, { enabled: true }, "admin");
  expect(await store.managedUser(m.userId)).toMatchObject({ banned: false });
});

test("admin lifecycle protects the last admin and rejects duplicate or forbidden creation inputs", async () => {
  await expect(store.updateUser("admin", true, "admin")).rejects.toMatchObject({
    code: "LAST_ADMIN",
  });
  const second = await store.createAdmin({ name: "Second", email: "second@example.com" }, "admin");
  expect(second).toMatchObject({ role: "admin", merchantId: null });
  await expect(
    store.createAdmin({ name: "Taken", email: "ONNE@example.com" }, "admin"),
  ).rejects.toMatchObject({ code: "EMAIL_EXISTS" });
  expect(
    (
      await call(
        request("/api/admin/users", { name: "Bad", email: "bad@example.com", role: "merchant" }),
        "admin",
      )
    ).status,
  ).toBe(400);
  await pg.query(
    "INSERT INTO session(id,token,user_id,expires_at) VALUES ($1,$1,$2,now()+interval '1 hour')",
    ["admin-session", second.id],
  );
  await store.updateUser(second.id, true, "admin");
  expect(
    (await pg.query("SELECT id FROM session WHERE user_id=$1", [second.id])).rows,
  ).toHaveLength(0);
  await expect(store.updateUser("admin", true, "admin")).rejects.toMatchObject({
    code: "LAST_ADMIN",
  });
  await expect(
    store.createAdmin({ name: "Bad", email: "bad@example.com" }, second.id),
  ).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
  await store.updateUser(second.id, false, "admin");
  expect(await store.users("admin", 100, 0)).toHaveLength(2);
  expect((await call(request(`/api/admin/users/${second.id}`), "admin")).status).toBe(200);
  await pg.exec("BEGIN; SELECT set_config('app.payment_admin','true',true)");
  expect(
    (await pg.query("SELECT action FROM admin_audit WHERE action='admin.created'")).rows,
  ).toHaveLength(1);
  await pg.exec("COMMIT");
});

const asAdmin = (statements: string) => pg.exec(`RESET ROLE; ${statements}; SET ROLE payment_app;`);
/** A reservation's status, read past row-level security; null once it is gone. */
async function statusOf(key: string) {
  await pg.exec("RESET ROLE");
  try {
    const { rows } = await pg.query<{ status: string }>(
      "SELECT status FROM payment_order WHERE idempotency_key = $1",
      [key],
    );
    return rows[0]?.status ?? null;
  } finally {
    await pg.exec("SET ROLE payment_app");
  }
}
/**
 * Starts an order whose invoice the wallet holds back, as a request stuck mid-invoice. `finish`
 * lets the wallet answer and settles the request.
 */
async function stuckOrder(key: string) {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const held: typeof Wallet.Service = {
    ...wallet.wallet,
    issueInvoice: (request) =>
      Effect.promise(() => gate).pipe(Effect.flatMap(() => wallet.wallet.issueInvoice(request))),
  };
  const settled = Effect.runPromise(
    intake.create("onne", key, { amountUsdCents: 1000 }).pipe(Effect.provideService(Wallet, held)),
  ).then(
    (order) => ({ order }),
    (error: unknown) => ({ error }),
  );
  await vi.waitFor(async () => expect(await statusOf(key)).toBe("creating"));
  return {
    finish: () => {
      open();
      return settled;
    },
  };
}
const walletEnv = {
  ...bindings,
  WALLET_URL: "https://wallet.example",
  WALLET_TOKEN: "g".repeat(32),
};

test("an overpaid order is paid; the excess is recorded but never owed to the merchant", async () => {
  const row = await createOrder(onne, key, { amountUsdCents: 1000 });
  await credit({ ...paid(row.id), receivedMsat: Millisats.make(12_000_000) });
  const admin = await (await call(request(`/api/admin/orders/${row.id}`), "admin")).json();
  expect(admin).toMatchObject({ status: "paid", receivedMsat: 12_000_000, excessMsat: 2_000_000 });
  expect(await store.summary(onne)).toMatchObject({ paidSat: 10000 });
  const short = await createOrder(onne, `${key}-short`, { amountUsdCents: 1000 });
  expect(await credited({ ...paid(short.id), receivedMsat: Millisats.make(9_999_000) })).toEqual({
    anomaly: "underpaid",
    orderId: short.id,
  });
});

test("a receipt that contradicts its order is logged as an anomaly and the order is kept", async () => {
  const row = await createOrder(onne, key, { amountUsdCents: 1000 });
  log.mockClear();
  wallet.contradict(row.id);
  const response = await call(request(`/api/public/orders/${row.id}`));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "pending" });
  expect(log).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "payment_anomaly",
      operation: "refresh_order",
      orderId: row.id,
      anomaly: "underpaid",
    }),
  );
  // The wallet's own 409 is an anomaly too, never an outage verdict.
  wallet.failNext("lookup", "mismatch");
  expect((await call(request(`/api/public/orders/${row.id}`))).status).toBe(200);
  expect(log).toHaveBeenLastCalledWith(
    expect.objectContaining({
      event: "payment_anomaly",
      orderId: row.id,
      anomaly: "wallet_reported",
    }),
  );
  // Receipts the sync reads are judged the same way.
  expect(await credited({ ...paid(row.id), paymentHash: "f".repeat(64) })).toEqual({
    anomaly: "contradicts_order",
    orderId: row.id,
  });
  const stranger = crypto.randomUUID();
  expect(await credited(paid(stranger))).toEqual({ anomaly: "unknown_order", orderId: stranger });
  expect((await store.getOrder(row.id)).status).toBe("pending");
});

test("payer reads stop asking the wallet ten minutes after expiry; admin reads always ask", async () => {
  const row = await createOrder(onne, key, { amountUsdCents: 1000 });
  await credit({
    ...invoice(row.id),
    expiresAt: new Date(Date.now() - 11 * 60_000).toISOString(),
  });
  expect(await (await call(request(`/api/public/orders/${row.id}`))).json()).toMatchObject({
    status: "expired",
  });
  expect(wallet.asked.lookup).toBe(0);
  wallet.pay(row.id);
  expect(await (await call(request(`/api/admin/orders/${row.id}`), "admin")).json()).toMatchObject({
    status: "paid",
  });
  expect(wallet.asked.lookup).toBe(1);
});

test("the payment sync credits receipts nobody polled, skips anomalies and keeps its cursor on failure", async () => {
  const row = await createOrder(onne, key, { amountUsdCents: 1000 });
  const contradicted = await createOrder(onne, `${key}-2`, { amountUsdCents: 1000 });
  const latest = Math.floor(Date.now() / 1000);
  // Receipts for an unknown order cannot come from the memory wallet, so this page is fixed.
  const completedSince = vi.fn<(typeof Wallet.Service)["completedSince"]>(() =>
    Effect.succeed({
      payments: [
        paid(row.id),
        { ...paid(contradicted.id), receivedMsat: Millisats.make(1) },
        paid(crypto.randomUUID()),
      ],
      latest,
      more: false,
    }),
  );
  const list = { ...wallet.wallet, completedSince };
  log.mockClear();
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    await syncPayments(store, crediting, list, log);
    expect(completedSince).toHaveBeenCalledWith(0);
    expect((await store.getOrder(row.id)).status).toBe("paid");
    expect((await store.getOrder(contradicted.id)).status).toBe("pending");
    expect(log.mock.calls.filter(([entry]) => entry.event === "payment_anomaly")).toHaveLength(2);
    // Re-reading overlapping receipts is harmless: crediting is idempotent.
    await syncPayments(store, crediting, list, log);
    expect(completedSince).toHaveBeenLastCalledWith(latest - 600);
    completedSince.mockReturnValueOnce(
      Effect.fail(new UpstreamFailure({ dependency: "wallet", reason: "network" })),
    );
    await expect(syncPayments(store, crediting, list, log)).rejects.toThrow();
    expect(await store.walletCursor()).toEqual(new Date(latest * 1000));
  } finally {
    info.mockRestore();
  }
});

test("the scheduled job releases abandoned reservations, syncs every minute and quotes every fifth", async () => {
  const stuck = await stuckOrder(`${key}-dead`);
  // One threshold: a reservation the same key could take over is also swept.
  await asAdmin(
    "UPDATE payment_order SET created_at = now() - interval '31 seconds' WHERE status = 'creating'",
  );
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    String(url).includes("coinbase")
      ? Response.json({ data: { amount: "64000", currency: "USD" } })
      : Response.json({ payments: [], latest: null, more: false }),
  );
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await runScheduled(walletEnv, Date.UTC(2026, 10, 19, 12, 1), { fetcher, connect });
    expect(await statusOf(`${key}-dead`)).toBeNull();
    // The request that died is refused if it wakes up: its invoice was never shown.
    expect(await stuck.finish()).toMatchObject({ error: { operation: "attach_invoice" } });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "https://wallet.example/v1/payments/completed",
    ]);
    await runScheduled(walletEnv, Date.UTC(2026, 10, 19, 12, 5), { fetcher, connect });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toContain(
      "https://api.coinbase.com/v2/prices/BTC-USD/spot",
    );
  } finally {
    info.mockRestore();
    error.mockRestore();
  }
});

test("a reservation in progress answers ORDER_IN_PROGRESS until abandoned, then the key is retried", async () => {
  const stuck = await stuckOrder(key);
  await expect(createOrder(onne, key, { amountUsdCents: 1000 })).rejects.toMatchObject({
    code: "ORDER_IN_PROGRESS",
  });
  await expect(createOrder(onne, key, { amountUsdCents: 1500 })).rejects.toMatchObject({
    code: "IDEMPOTENCY_CONFLICT",
  });
  const busy = await call(
    request(
      "/api/public/merchants/onne/orders",
      { amountUsdCents: 1000 },
      { "idempotency-key": key },
    ),
  );
  expect(busy.status).toBe(409);
  expect(busy.headers.get("retry-after")).toBe("1");
  // Reservations never surface as orders.
  expect(await store.orders({ merchantId: onne }, 10, 0)).toHaveLength(0);
  // A young reservation survives the sweep.
  expect(await intake.sweep()).toBe(0);
  await asAdmin("UPDATE payment_order SET created_at = now() - interval '31 seconds'");
  const retried = await createOrder(onne, key, { amountUsdCents: 1000 });
  expect(retried).toMatchObject({ status: "pending" });
  // The request that was taken over cannot attach its invoice to the new order.
  expect(await stuck.finish()).toMatchObject({ error: { operation: "attach_invoice" } });
  expect((await store.getOrder(retried.id)).invoice).toBe(retried.invoice);
});

test("admission caps invoices across the platform, not only per merchant", async () => {
  await store.createMerchant({ slug: "third", name: "Third", email: "third@example.com" }, "admin");
  for (let i = 0; i < 5; i++) {
    await createOrder(onne, `${key}-a${i}`, { amountUsdCents: 1000 });
    await createOrder(other, `${key}-b${i}`, { amountUsdCents: 1000 });
  }
  await expect(createOrder("third", `${key}-c0`, { amountUsdCents: 1000 })).rejects.toMatchObject({
    code: "RATE_LIMITED",
  });
  expect(wallet.asked.issueInvoice).toBe(10);
});

test("the payer API refuses requests over the edge rate limits, keyed by IP and merchant", async () => {
  const denied = { limit: vi.fn(async () => ({ success: false })) };
  const allowed = { limit: vi.fn(async () => ({ success: true })) };
  const ip = { "cf-connecting-ip": "203.0.113.7" };
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  try {
    const read = await worker.fetch(request("/api/public/merchants/onne", undefined, ip), {
      ...walletEnv,
      PUBLIC_RATE_LIMITER: denied,
      ORDER_RATE_LIMITER: allowed,
    });
    expect(read.status).toBe(429);
    expect(denied.limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
    const create = await worker.fetch(
      request(
        "/api/public/merchants/onne/orders",
        { amountUsdCents: 1000 },
        { ...ip, "idempotency-key": key },
      ),
      { ...walletEnv, PUBLIC_RATE_LIMITER: allowed, ORDER_RATE_LIMITER: denied },
    );
    expect(create.status).toBe(429);
    expect(denied.limit).toHaveBeenLastCalledWith({ key: "203.0.113.7:onne" });
    // A refused request never reaches the wallet.
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    error.mockRestore();
  }
});

test("unconfirmed orders count only invoices that can still be paid", async () => {
  await createOrder(onne, key, { amountUsdCents: 1000 });
  const old = await createOrder(onne, `${key}-old`, { amountUsdCents: 1000 });
  await credit({ ...invoice(old.id), expiresAt: new Date(Date.now() - 1000).toISOString() });
  expect(await store.summary(onne)).toMatchObject({ unconfirmedOrderCount: 1 });
});

test("production wallet calls carry the Cloudflare Access service token", async () => {
  const base = { WALLET_URL: "https://wallet.example", WALLET_TOKEN: "g".repeat(32) };
  expect(() => parseWalletConfig(base)).toThrow();
  expect(() => parseWalletConfig({ ...base, WALLET_ACCESS_CLIENT_ID: "id.access" })).toThrow();
  const config = parseWalletConfig({
    ...base,
    WALLET_ACCESS_CLIENT_ID: "id.access",
    WALLET_ACCESS_CLIENT_SECRET: "access-secret",
  });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ payments: [], latest: null, more: false }))
    .mockResolvedValueOnce(Response.json({ code: "PAYMENT_MISMATCH" }, { status: 409 }));
  const wallet = makeWallet(config, { fetcher });
  await Effect.runPromise(wallet.completedSince(5));
  expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
    authorization: `Bearer ${"g".repeat(32)}`,
    "cf-access-client-id": "id.access",
    "cf-access-client-secret": "access-secret",
  });
  const body = fetcher.mock.calls[0][1]?.body as Uint8Array;
  expect(JSON.parse(new TextDecoder().decode(body))).toEqual({ since: 5 });
  await expect(
    Effect.runPromise(
      wallet.issueInvoice({ orderId: crypto.randomUUID(), amountSat: Sats.make(1) }),
    ),
  ).rejects.toMatchObject({
    reason: "mismatch",
    upstreamStatus: 409,
  });
});

test("admin write origins are compared with the normalized auth URL", async () => {
  const env = {
    ...bindings,
    BETTER_AUTH_URL: "http://localhost:3000/",
    BETTER_AUTH_SECRET: "test-only-42ef97c3a18b46d8a0921dc78359ba77",
  };
  const write = (origin: string) =>
    worker.fetch(
      request(
        "/api/admin/merchants",
        { name: "N", email: "n@example.com", slug: "nnn" },
        { origin },
      ),
      env,
    );
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    // Same origin: passes the origin check and stops at the missing session.
    expect((await write("http://localhost:3000")).status).toBe(401);
    expect((await write("https://evil.example")).status).toBe(403);
  } finally {
    error.mockRestore();
  }
});
