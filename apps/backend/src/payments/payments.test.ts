import { URL as NodeURL } from "node:url";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Context, Effect, Schema } from "effect";
import { PaymentProblem, PublicOrder } from "@btc-lightning-pay/api";
import type { Database } from "@btc-lightning-pay/db/client";
import * as schema from "@btc-lightning-pay/db/schema";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vite-plus/test";
import { createPaymentStore } from "./store";
import { publicOrder } from "./projection";
import { createPaymentService, type WalletClient } from "./service";
import { createWalletClient } from "./wallet-client";
import { paymentApp, PaymentRuntime } from "./app";
import worker from "../index";
import { recoverOrders } from "./recovery";

const pg = new PGlite();
const database = drizzle(pg, { schema });
const close = vi.fn(async () => {});
vi.mock("@btc-lightning-pay/db/client", () => ({ createDatabase: () => ({ database, close }) }));
const store = createPaymentStore(database as unknown as Database);
const quote = vi.fn(async () => ({ rateUsd: "100000", quotedAt: new Date() }));
const key = "test-order-key-0001";
const bindings = { DATABASE_URL: "postgres://local/test" };
const wallet = vi.fn<WalletClient>(async () => null);
const request = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const log = vi.fn();
const payments = createPaymentService(store, quote, wallet, log);
const createOrder = (
  merchant: string,
  key: string,
  input: { amountUsdCents: number; reference?: string },
) => Effect.runPromise(payments.createOrder(merchant, key, input));
const call = (req: Request, actor?: string) =>
  paymentApp.handler(req, Context.make(PaymentRuntime, { store, payments, log, actor }));
const invoice = (id: string, amountSat = 10000) => ({
  orderId: id,
  amountSat,
  invoice: "lnbc100u1test",
  paymentHash: id.replaceAll("-", "").repeat(2),
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  paidAt: null,
  receivedMsat: null,
});
const paid = (id: string, amountSat = 10000) => ({
  ...invoice(id, amountSat),
  paidAt: new Date().toISOString(),
  receivedMsat: amountSat * 1000,
});

beforeAll(async () => {
  await pg.exec(
    readFileSync(new NodeURL("../../../../packages/db/sql/schema.sql", import.meta.url), "utf8"),
  );
  await pg.exec(`CREATE ROLE payment_app NOSUPERUSER NOBYPASSRLS;
    GRANT USAGE ON SCHEMA public TO payment_app;
    GRANT SELECT, INSERT, UPDATE ON merchant, payment_order, settlement, settlement_item TO payment_app;
    INSERT INTO public."user" (id,name,email) VALUES ('admin','Admin','admin@example.com');`);
  const provision = readFileSync(
    new NodeURL("../../../../packages/db/sql/provision-backend-role.sql", import.meta.url),
    "utf8",
  );
  await pg.exec(provision);
  await pg.exec(provision);
  await pg.exec("SET ROLE btc_backend;");
  expect((await pg.query('SELECT * FROM public."user"')).rows).toHaveLength(1);
  expect((await pg.query("SELECT * FROM payment_order")).rows).toHaveLength(0);
  await pg.exec("RESET ROLE;");
});
beforeEach(async () => {
  await pg.exec(
    "RESET ROLE; TRUNCATE settlement_item, payment_order, settlement, merchant; SET ROLE payment_app;",
  );
  await store.createMerchant("onne");
  await store.createMerchant("other");
  quote.mockClear();
  wallet.mockReset();
  wallet.mockResolvedValue(null);
  close.mockClear();
});
afterAll(async () => {
  await paymentApp.dispose();
  await pg.close();
});

test("idempotency survives repeated requests, conflicts reject and disabled merchants preserve existing orders", async () => {
  const rows = await Promise.all([
    createOrder("onne", key, { amountUsdCents: 1000 }),
    createOrder("onne", key, { amountUsdCents: 1000 }),
  ]);
  expect(rows[0].id).toBe(rows[1].id);
  expect(quote.mock.calls.length).toBeGreaterThan(0);
  const quoteCalls = quote.mock.calls.length;
  await createOrder("onne", key, { amountUsdCents: 1000 });
  expect(quote).toHaveBeenCalledTimes(quoteCalls);
  await expect(createOrder("onne", key, { amountUsdCents: 1500 })).rejects.toMatchObject({
    code: "IDEMPOTENCY_CONFLICT",
  });
  const other = await createOrder("other", key, { amountUsdCents: 1000 });
  expect(other.id).not.toBe(rows[0].id);
  await store.updateMerchant("onne", false);
  expect((await createOrder("onne", key, { amountUsdCents: 1000 })).id).toBe(rows[0].id);
  await expect(
    createOrder("onne", "new-order-key-0001", { amountUsdCents: 1000 }),
  ).rejects.toMatchObject({ code: "MERCHANT_DISABLED" });
});
test("payment updates are monotonic, late payments are credited and net cost is separate from merchant payable", async () => {
  const row = await createOrder("onne", key, { amountUsdCents: 1000 });
  const pending = { ...invoice(row.id), expiresAt: new Date(Date.now() - 1000).toISOString() };
  expect(publicOrder(await store.sync(pending)).status).toBe("expired");
  const payment = { ...paid(row.id), expiresAt: pending.expiresAt };
  await store.sync(payment);
  await store.sync(payment);
  await store.sync(pending);
  expect(publicOrder(await store.getOrder(row.id)).status).toBe("paid");
  expect(await store.summary("onne")).toMatchObject({
    merchantId: "onne",
    paidSat: 10000,
    settledSat: 0,
    unsettledSat: 10000,
  });
  expect(await store.summary("other")).toMatchObject({ paidSat: 0 });
  await expect(store.sync({ ...payment, receivedMsat: 1 })).rejects.toMatchObject({
    code: "PAYMENT_MISMATCH",
  });
});
test("batch lifecycle freezes amounts, reserves orders, retains cancelled history and confirms idempotently", async () => {
  const a = await createOrder("onne", key, { amountUsdCents: 1000 });
  const b = await createOrder("other", key, { amountUsdCents: 1000 });
  await store.sync(paid(a.id));
  await store.sync(paid(b.id));
  const { record } = await store.settle(key, { merchantId: "onne" }, "admin");
  expect(record).toMatchObject({
    status: "pending",
    amountSat: 10000,
    orderCount: 1,
    createdBy: "admin",
  });
  expect(await store.summary("onne")).toMatchObject({
    settledSat: 0,
    pendingSettlementSat: 10000,
    availableSettlementSat: 0,
  });
  expect((await store.settle(key, { merchantId: "onne" }, "admin")).record.id).toBe(record.id);
  await expect(store.settle(key, { merchantId: "other" }, "admin")).rejects.toMatchObject({
    code: "IDEMPOTENCY_CONFLICT",
  });
  await expect(
    store.settle("other-batch-key", { merchantId: "onne" }, "admin"),
  ).rejects.toMatchObject({ code: "NO_ELIGIBLE_ORDERS" });
  const later = await createOrder("onne", "later-order-key-0001", { amountUsdCents: 1000 });
  await store.sync(paid(later.id));
  expect((await store.settlementOrders(record.id, 50, 0)).items).toEqual([
    { orderId: a.id, merchantId: "onne", amountSat: 10000 },
  ]);
  expect((await store.settlement(record.id)).amountSat).toBe(10000);
  await store.cancelSettlement(record.id, "not paid", "admin");
  expect((await store.settlementOrders(record.id, 50, 0)).total).toBe(1);
  expect(await store.summary("onne")).toMatchObject({
    availableSettlementSat: 20000,
    pendingSettlementSat: 0,
  });
  await expect(store.confirmSettlement(record.id, "proof", "admin")).rejects.toMatchObject({
    code: "SETTLEMENT_STATE_CONFLICT",
  });
  const next = (await store.settle("replacement-batch-key", { merchantId: "onne" }, "admin"))
    .record;
  expect(next.orderCount).toBe(2);
  const confirmed = await store.confirmSettlement(next.id, " transfer-1 ", "admin");
  expect(await store.confirmSettlement(next.id, "transfer-1", "admin")).toEqual(confirmed);
  await expect(store.confirmSettlement(next.id, "different", "admin")).rejects.toMatchObject({
    code: "SETTLEMENT_PROOF_CONFLICT",
  });
  await expect(store.cancelSettlement(next.id, "oops", "admin")).rejects.toMatchObject({
    code: "SETTLEMENT_STATE_CONFLICT",
  });
  expect(await store.summary("onne")).toMatchObject({
    settledSat: 20000,
    unsettledSat: 0,
    pendingSettlementSat: 0,
  });
  expect(await store.summary("other")).toMatchObject({
    settledSat: 0,
    availableSettlementSat: 10000,
  });
});

test("batch HTTP rejects old bodies, paginates history, and exposes independent settlement status", async () => {
  const row = await createOrder("onne", key, { amountUsdCents: 1000 });
  await store.sync(paid(row.id));
  const headers = { "idempotency-key": key };
  expect(
    (
      await call(
        request(
          "/api/admin/settlements",
          { merchantId: "onne", orderIds: [row.id], amountSat: 10000, proof: "old" },
          headers,
        ),
        "admin",
      )
    ).status,
  ).toBe(400);
  const response = await call(
    request("/api/admin/settlements", { merchantId: "onne" }, headers),
    "admin",
  );
  expect(response.status).toBe(201);
  const batch = (await response.json()) as { id: string };
  expect(
    (await call(request("/api/admin/settlements", { merchantId: "onne" }, headers), "admin"))
      .status,
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
  expect(
    (await call(request(`/api/admin/settlements/${batch.id}/confirm`, { proof: "wire" }))).status,
  ).toBe(403);
  expect(
    (await call(request(`/api/admin/settlements/${batch.id}/confirm`, { proof: "wire" }), "admin"))
      .status,
  ).toBe(200);
});
test("real non-owner RLS isolates merchants and public orders and resets on the pooled connection", async () => {
  const a = await createOrder("onne", key, { amountUsdCents: 1000 });
  await createOrder("other", key, { amountUsdCents: 1000 });
  for (const table of ["merchant", "payment_order", "settlement"])
    expect((await pg.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0);
  await pg.exec("BEGIN; SELECT set_config('app.merchant_id','onne',true);");
  try {
    expect((await pg.query("SELECT * FROM merchant")).rows).toHaveLength(1);
    expect((await pg.query("SELECT * FROM payment_order")).rows).toHaveLength(1);
    await expect(
      pg.exec(
        `INSERT INTO payment_order (id,merchant_id,idempotency_key,amount_usd_cents,amount_sat,rate_usd,quoted_at) VALUES (gen_random_uuid(),'other','forged',1000,10000,'100000',now())`,
      ),
    ).rejects.toThrow(/row-level security/);
  } finally {
    await pg.exec("ROLLBACK");
  }
  await pg.exec("BEGIN");
  expect((await pg.query("SELECT * FROM payment_order")).rows).toHaveLength(0);
  await pg.exec("COMMIT");
  expect((await store.getOrder(a.id)).merchantId).toBe("onne");
  await expect(store.getOrder(crypto.randomUUID())).rejects.toMatchObject({
    code: "ORDER_NOT_FOUND",
  });
});
test("public HTTP contracts validate amounts and keep internal data out of responses", async () => {
  const path = "/api/public/merchants/onne/orders";
  expect((await call(request(path, { amountUsdCents: 1000 }))).status).toBe(400);
  expect(
    (await call(request(path, { amountUsdCents: 999 }, { "idempotency-key": key }))).status,
  ).toBe(400);
  expect(quote).not.toHaveBeenCalled();
  const response = await call(
    request(path, { amountUsdCents: 1000, reference: "private" }, { "idempotency-key": key }),
  );
  expect(response.status).toBe(200);
  const raw = await response.json();
  const body = Schema.decodeUnknownSync(PublicOrder)(raw);
  expect(body).toMatchObject({ status: "creating", amountSat: 10000, invoice: null });
  expect(raw).toEqual(body);
  wallet.mockRejectedValueOnce(new Error("secret upstream detail"));
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
  expect((await call(request("/api/admin/orders"))).status).toBe(403);
  expect((await call(request("/api/admin/orders"), "admin")).status).toBe(200);
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
    for (let i = 0; i < 5; i++) await createOrder("onne", `${key}-${i}`, { amountUsdCents: 1000 });
    await expect(createOrder("onne", `${key}-6`, { amountUsdCents: 1000 })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect((await createOrder("onne", `${key}-0`, { amountUsdCents: 1000 })).amountSat).toBe(10000);
  } finally {
    vi.restoreAllMocks();
  }
});
test("Worker wallet client refuses redirects and mismatched order data", async () => {
  const id = crypto.randomUUID();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://elsewhere.example" } }),
    );
  const client = createWalletClient("https://wallet.example", "g".repeat(32), fetcher);
  await expect(client(id, 10000)).rejects.toThrow();
  fetcher.mockResolvedValueOnce(Response.json(invoice(crypto.randomUUID())));
  await expect(client(id, 10000)).rejects.toMatchObject({ reason: "mismatch" });
  fetcher.mockResolvedValueOnce(Response.json(null, { status: 202 }));
  expect(await client(id, 10000)).toBeNull();
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

test("scheduled recovery records safe upstream context and retries the same durable order", async () => {
  const row = await createOrder("onne", key, { amountUsdCents: 1000 });
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
    await recoverOrders(env);
    expect((await store.getOrder(row.id)).status).toBe("creating");
    const entry = JSON.parse(String(errorLog.mock.calls[0][0]));
    expect(entry).toMatchObject({
      operation: "recover_order",
      orderId: row.id,
      dependency: "wallet",
      reason: "http",
      upstreamStatus: 502,
      durationMs: expect.any(Number),
      requestId: expect.any(String),
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("sensitive-upstream-response");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(env.WALLET_TOKEN);
    await recoverOrders(env);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await pg.exec(
      "RESET ROLE; UPDATE payment_order SET attempted_at=now()-interval '1 second'; SET ROLE payment_app",
    );
    await recoverOrders(env);
    expect((await store.getOrder(row.id)).status).toBe("pending");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body);
  } finally {
    vi.unstubAllGlobals();
    errorLog.mockRestore();
  }
});

test("concurrent requests retain one displayed invoice and queries never recreate it", async () => {
  wallet.mockImplementation(async (id) => invoice(id));
  const [a, b] = await Promise.all([
    createOrder("onne", key, { amountUsdCents: 1000 }),
    createOrder("onne", key, { amountUsdCents: 1000 }),
  ]);
  expect(a.paymentHash).toBe(b.paymentHash);
  expect(wallet.mock.calls.filter((call) => !call[3])).toHaveLength(1);
  wallet.mockImplementation(async (id) => paid(id));
  const response = await call(request(`/api/public/orders/${a.id}`));
  expect(await response.json()).toMatchObject({ status: "paid", invoice: a.invoice });
  expect(wallet).toHaveBeenLastCalledWith(
    a.id,
    a.amountSat,
    expect.any(AbortSignal),
    a.paymentHash,
    a.invoice,
  );
  wallet.mockClear();
  await call(request(`/api/public/orders/${a.id}`));
  expect(wallet).not.toHaveBeenCalled();
});

test("cron checks pending and expired invoices after the browser closes", async () => {
  const row = await createOrder("onne", key, { amountUsdCents: 1000 });
  const expired = { ...paid(row.id), expiresAt: new Date(Date.now() - 1000).toISOString() };
  await store.sync({ ...expired, paidAt: null, receivedMsat: null });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(expired));
  vi.stubGlobal("fetch", fetcher);
  try {
    await recoverOrders({
      ...bindings,
      WALLET_URL: "https://wallet.example",
      WALLET_TOKEN: "g".repeat(32),
    });
    expect((await store.getOrder(row.id)).status).toBe("paid");
    expect(fetcher.mock.calls[0][0]).toBe("https://wallet.example/v1/payments/query");
  } finally {
    vi.unstubAllGlobals();
  }
});

test("a failed unexposed creation can retry on the same order", async () => {
  wallet.mockRejectedValueOnce(new Error("creation response lost"));
  const first = await createOrder("onne", key, { amountUsdCents: 1000 });
  expect(first.invoice).toBeNull();
  wallet.mockImplementation(async (id) => invoice(id));
  const retry = await createOrder("onne", key, { amountUsdCents: 1000 });
  expect(retry.id).toBe(first.id);
  expect(retry.invoice).toBe("lnbc100u1test");
  expect(wallet.mock.calls.filter((call) => !call[3])).toHaveLength(2);
});
