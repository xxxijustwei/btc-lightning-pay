import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { createJobStore } from "./store.ts";
import { createGatewayService } from "./gateway.ts";
import { createPhoenixClient } from "./phoenix.ts";
import { gatewayWebHandler } from "./app.ts";
import { parseConfig } from "./config.ts";
import type { GatewayPayment } from "@btc-lightning-pay/api/payments";

const id = "12345678-1234-4234-8234-123456789abc";
const config = parseConfig({
  GATEWAY_TOKEN: "g".repeat(32),
  WORKER_SYNC_TOKEN: "w".repeat(32),
  WORKER_URL: "http://localhost:8787",
  PHOENIX_URL: "http://localhost:9740",
  PHOENIX_HTTP_PASSWORD: "private-password",
  PHOENIX_WEBHOOK_SECRET: "webhook-secret",
});
const pending: typeof GatewayPayment.Type = {
  orderId: id,
  amountSat: 10000,
  paymentHash: "a".repeat(64),
  invoice: "lnbc100u1test",
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  paidAt: null,
  receivedMsat: null,
  feeMsat: null,
};

test("a timed-out create survives restart and recovers without creating a second invoice", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lightning-gateway-"));
  let db = new DatabaseSync(join(dir, "jobs.sqlite"));
  const phoenix = {
    create: vi.fn(async () => {
      throw new Error("response lost");
    }),
    find: vi.fn(async () => pending),
  };
  const notify = vi.fn(async () => {});
  try {
    const first = createGatewayService(createJobStore(db), phoenix, notify);
    await expect(first.create({ orderId: id, amountSat: 10000 })).rejects.toThrow("response lost");
    db.close();
    db = new DatabaseSync(join(dir, "jobs.sqlite"));
    const restarted = createGatewayService(createJobStore(db), phoenix, notify);
    expect(await restarted.create({ orderId: id, amountSat: 10000 })).toEqual(pending);
    expect(phoenix.create).toHaveBeenCalledTimes(1);
    await expect(restarted.create({ orderId: id, amountSat: 10001 })).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    const paid = {
      ...pending,
      paidAt: new Date().toISOString(),
      receivedMsat: 9999000,
      feeMsat: 1000,
    };
    phoenix.find.mockResolvedValue(paid);
    notify.mockRejectedValueOnce(new Error("Worker offline"));
    await expect(restarted.received(id)).rejects.toThrow("Worker offline");
    await restarted.received(id);
    expect(notify).toHaveBeenLastCalledWith(paid);
    expect(createJobStore(db).due()).toEqual([]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("HTTP composition validates input, authenticates creation, and verifies raw webhook signatures", async () => {
  const db = new DatabaseSync(":memory:");
  const phoenix = { create: vi.fn(async () => {}), find: vi.fn(async () => pending) };
  const service = createGatewayService(
    createJobStore(db),
    phoenix,
    vi.fn(async () => {}),
  );
  const app = gatewayWebHandler(config, service);
  const create = (body: unknown, token = config.token) =>
    app.handler(
      new Request("http://localhost/v1/invoices", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
    );
  try {
    expect((await app.handler(new Request("http://localhost/health"))).status).toBe(200);
    expect((await create({ orderId: id, amountSat: 10000 }, "bad")).status).toBe(401);
    expect((await create({ orderId: "bad", amountSat: -1 })).status).toBe(400);
    expect(phoenix.create).not.toHaveBeenCalled();
    const response = await create({ orderId: id, amountSat: 10000 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(pending);
    const body = JSON.stringify({ type: "payment_received", externalId: id });
    const hook = (signature: string) =>
      app.handler(
        new Request("http://localhost/v1/phoenix/webhook", {
          method: "POST",
          headers: { "content-type": "application/json", "x-phoenix-signature": signature },
          body,
        }),
      );
    expect((await hook("wrong")).status).toBe(401);
    expect(
      (await hook(createHmac("sha256", config.webhookSecret!).update(body).digest("hex"))).status,
    ).toBe(200);
    expect(
      (await app.handler(new Request("http://localhost/payinvoice", { method: "POST" }))).status,
    ).toBe(404);
  } finally {
    await app.dispose();
    db.close();
  }
});
test("Phoenix lookup checks uniqueness, association and net accounting; only safe fields leave the client", async () => {
  const raw = {
    externalId: id,
    requestedSat: 10000,
    receivedSat: 9999,
    fees: 1000,
    isPaid: true,
    paymentHash: pending.paymentHash,
    invoice: pending.invoice,
    expiresAt: Date.now() + 3600000,
    completedAt: Date.now(),
    preimage: "never-export-this",
  };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json([raw]));
  const client = createPhoenixClient(config, fetcher);
  expect(await client.find(id, 10000)).toMatchObject({ receivedMsat: 9999000, feeMsat: 1000 });
  expect(fetcher.mock.calls[0][0]).toContain("all=true");
  fetcher.mockResolvedValueOnce(Response.json([raw, raw]));
  await expect(client.find(id, 10000)).rejects.toThrow("Multiple invoices");
  fetcher.mockResolvedValueOnce(Response.json([{ ...raw, receivedSat: 10000 }]));
  await expect(client.find(id, 10000)).rejects.toThrow("reconciliation");
  fetcher.mockResolvedValueOnce(Response.json([{ ...raw, externalId: crypto.randomUUID() }]));
  await expect(client.find(id, 10000)).rejects.toThrow("mismatch");
});
test("configuration fails closed without printing invalid service credentials", () => {
  expect(() => parseConfig({ GATEWAY_TOKEN: "private" })).toThrow("Invalid GATEWAY_TOKEN");
  expect(() => parseConfig({ GATEWAY_TOKEN: "private" })).not.toThrow("private");
});
