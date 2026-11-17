import { fileURLToPath, URL as NodeURL } from "node:url";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Context, Schema } from "effect";
import { PublicOrder } from "@btc-lightning-pay/api";
import type { Database } from "@btc-lightning-pay/db/client";
import * as schema from "@btc-lightning-pay/db/schema";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vite-plus/test";
import { createPaymentStore, publicOrder } from "./store";
import { paymentApp, PaymentRuntime, createGatewayClient } from "./app";
import worker from "../index";

const pg = new PGlite();
const database = drizzle(pg, { schema });
const close = vi.fn(async () => {});
vi.mock("@btc-lightning-pay/db/client", () => ({ createDatabase: () => ({ database, close }) }));
const store = createPaymentStore(database as unknown as Database);
const quote = vi.fn(async () => ({ rateUsd: "100000", quotedAt: new Date() }));
const key = "test-order-key-0001";
const bindings = { DATABASE_URL: "postgres://local/test", WORKER_SYNC_TOKEN: "s".repeat(32) };
const gateway = vi.fn<typeof PaymentRuntime.Service.gateway>(async () => null);
const request = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const call = (req: Request, actor?: string) =>
  paymentApp.handler(req, Context.make(PaymentRuntime, { store, quote, gateway, actor }));
const invoice = (id: string, amountSat = 10000) => ({
  orderId: id,
  amountSat,
  invoice: "lnbc100u1test",
  paymentHash: id.replaceAll("-", "").repeat(2),
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  paidAt: null,
  receivedMsat: null,
  feeMsat: null,
});
const paid = (id: string, amountSat = 10000) => ({
  ...invoice(id, amountSat),
  paidAt: new Date().toISOString(),
  receivedMsat: amountSat * 1000 - 1000,
  feeMsat: 1000,
});

beforeAll(async () => {
  await migrate(database, {
    migrationsFolder: fileURLToPath(
      new NodeURL("../../../../packages/db/drizzle", import.meta.url),
    ),
    migrationsSchema: "public",
    migrationsTable: "__btc_lightning_pay_migrations",
  });
  await pg.exec(`CREATE ROLE payment_app NOSUPERUSER NOBYPASSRLS;
    GRANT USAGE ON SCHEMA public TO payment_app;
    GRANT SELECT, INSERT, UPDATE ON merchant, payment_order, settlement TO payment_app;
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
  await expect(pg.exec("SELECT * FROM public.__btc_lightning_pay_migrations")).rejects.toThrow(
    /permission denied/,
  );
  await pg.exec("RESET ROLE;");
});
beforeEach(async () => {
  await pg.exec("RESET ROLE; TRUNCATE payment_order, settlement, merchant; SET ROLE payment_app;");
  await store.createMerchant("onne");
  await store.createMerchant("other");
  quote.mockClear();
  gateway.mockReset();
  gateway.mockResolvedValue(null);
  close.mockClear();
});
afterAll(async () => {
  await paymentApp.dispose();
  await pg.close();
});

test("idempotency survives repeated requests, conflicts reject and disabled merchants preserve existing orders", async () => {
  const rows = await Promise.all([
    store.createOrder("onne", key, { amountUsdCents: 1000 }, quote),
    store.createOrder("onne", key, { amountUsdCents: 1000 }, quote),
  ]);
  expect(rows[0].id).toBe(rows[1].id);
  expect(quote).toHaveBeenCalledTimes(1);
  await expect(
    store.createOrder("onne", key, { amountUsdCents: 1500 }, quote),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  const other = await store.createOrder("other", key, { amountUsdCents: 1000 }, quote);
  expect(other.id).not.toBe(rows[0].id);
  await store.updateMerchant("onne", false);
  expect((await store.createOrder("onne", key, { amountUsdCents: 1000 }, quote)).id).toBe(
    rows[0].id,
  );
  await expect(
    store.createOrder("onne", "new-order-key-0001", { amountUsdCents: 1000 }, quote),
  ).rejects.toMatchObject({ code: "MERCHANT_DISABLED" });
});
test("payment updates are monotonic, late payments are credited and net cost is separate from merchant payable", async () => {
  const row = await store.createOrder("onne", key, { amountUsdCents: 1000 }, quote);
  const pending = { ...invoice(row.id), expiresAt: new Date(Date.now() - 1000).toISOString() };
  expect(publicOrder(await store.sync(pending)).status).toBe("expired");
  const payment = { ...paid(row.id), expiresAt: pending.expiresAt };
  await store.sync(payment);
  await store.sync(payment);
  await store.sync(pending);
  expect(publicOrder(await store.getOrder(row.id)).status).toBe("paid");
  expect(await store.summary("onne")).toEqual({
    merchantId: "onne",
    paidSat: 10000,
    settledSat: 0,
    unsettledSat: 10000,
  });
  expect(await store.summary("other")).toMatchObject({ paidSat: 0 });
  await expect(store.sync({ ...payment, feeMsat: 0 })).rejects.toMatchObject({
    code: "PAYMENT_MISMATCH",
  });
});
test("settlement is atomic, tenant-bound, attributed to its admin and cannot settle an order twice", async () => {
  const a = await store.createOrder("onne", key, { amountUsdCents: 1000 }, quote);
  const b = await store.createOrder("other", key, { amountUsdCents: 1000 }, quote);
  await store.sync(paid(a.id));
  await store.sync(paid(b.id));
  const input = {
    merchantId: "onne",
    orderIds: [a.id],
    amountSat: 10000,
    proof: "external-transfer-reference",
  };
  await expect(store.settle(key, { ...input, orderIds: [b.id] }, "admin")).rejects.toMatchObject({
    code: "SETTLEMENT_CONFLICT",
  });
  await expect(store.settle(key, { ...input, amountSat: 9999 }, "admin")).rejects.toMatchObject({
    code: "SETTLEMENT_CONFLICT",
  });
  const record = await store.settle(key, input, "admin");
  expect(record.createdBy).toBe("admin");
  expect((await store.settle(key, input, "admin")).id).toBe(record.id);
  await expect(store.settle("other-settlement-key", input, "admin")).rejects.toMatchObject({
    code: "SETTLEMENT_CONFLICT",
  });
  expect(await store.summary("onne")).toMatchObject({ settledSat: 10000, unsettledSat: 0 });
  expect(await store.summary("other")).toMatchObject({ settledSat: 0, unsettledSat: 10000 });
});
test("real non-owner RLS isolates merchants and public orders and resets on the pooled connection", async () => {
  const a = await store.createOrder("onne", key, { amountUsdCents: 1000 }, quote);
  await store.createOrder("other", key, { amountUsdCents: 1000 }, quote);
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
  gateway.mockRejectedValueOnce(new Error("secret upstream detail"));
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
test("Worker sync authenticates, validates financial data and acknowledges only persisted payments", async () => {
  const row = await store.createOrder("onne", key, { amountUsdCents: 1000 }, quote);
  const path = "/api/internal/payments/sync";
  expect((await worker.fetch(request(path, paid(row.id)), bindings)).status).toBe(401);
  const headers = { authorization: `Bearer ${bindings.WORKER_SYNC_TOKEN}` };
  expect(
    (await worker.fetch(request(path, { ...paid(row.id), receivedMsat: 1 }, headers), bindings))
      .status,
  ).toBe(409);
  expect((await worker.fetch(request(path, paid(row.id), headers), bindings)).status).toBe(200);
  expect((await store.getOrder(row.id)).status).toBe("paid");
});
test("admission bounds per-merchant invoice creation without charging duplicate requests", async () => {
  // Freeze only the application clock so all six checks share the same one-second window.
  vi.spyOn(Date, "now").mockReturnValue(Date.now() - 1000);
  try {
    for (let i = 0; i < 5; i++)
      await store.createOrder("onne", `${key}-${i}`, { amountUsdCents: 1000 }, quote);
    await expect(
      store.createOrder("onne", `${key}-6`, { amountUsdCents: 1000 }, quote),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(
      (await store.createOrder("onne", `${key}-0`, { amountUsdCents: 1000 }, quote)).amountSat,
    ).toBe(10000);
  } finally {
    vi.restoreAllMocks();
  }
});
test("Worker gateway client refuses redirects and mismatched order data", async () => {
  const id = crypto.randomUUID();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://elsewhere.example" } }),
    );
  const client = createGatewayClient("https://gateway.example", "g".repeat(32), fetcher);
  await expect(client(id, 10000)).rejects.toThrow();
  fetcher.mockResolvedValueOnce(Response.json(invoice(crypto.randomUUID())));
  await expect(client(id, 10000)).rejects.toThrow("mismatch");
  fetcher.mockResolvedValueOnce(Response.json(null, { status: 202 }));
  expect(await client(id, 10000)).toBeNull();
});
