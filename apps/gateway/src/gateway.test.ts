import { expect, test, vi } from "vite-plus/test";
import { createPhoenixClient } from "./phoenix.ts";
import { gatewayWebHandler } from "./app.ts";
import { parseConfig } from "./config.ts";
import { GatewayPayment, PaymentProblem } from "@btc-lightning-pay/api/payments";
import { Schema } from "effect";
const id = "12345678-1234-4234-8234-123456789abc";
const config = parseConfig({
  GATEWAY_TOKEN: "g".repeat(32),
  PHOENIX_URL: "http://localhost:9740",
  PHOENIX_HTTP_PASSWORD: "private-password",
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
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(raw));
  const client = createPhoenixClient(config, fetcher);
  expect(await client.find(id, 10000, pending.paymentHash)).toMatchObject({
    receivedMsat: 9999000,
    feeMsat: 1000,
  });
  expect(fetcher.mock.calls[0][0]).toContain(pending.paymentHash);
  fetcher.mockResolvedValueOnce(Response.json({ ...raw, receivedSat: 10000 }));
  await expect(client.find(id, 10000, pending.paymentHash)).rejects.toMatchObject({
    reason: "mismatch",
  });
  fetcher.mockResolvedValueOnce(Response.json({ ...raw, externalId: crypto.randomUUID() }));
  await expect(client.find(id, 10000, pending.paymentHash)).rejects.toMatchObject({
    reason: "mismatch",
  });
});
test.each(["invoice", "expiresAt", "paymentHash"])(
  "malformed Phoenix %s is classified without exposing the response",
  async (field) => {
    const raw = {
      externalId: id,
      requestedSat: 10000,
      receivedSat: 0,
      fees: 0,
      isPaid: false,
      paymentHash: pending.paymentHash,
      invoice: pending.invoice,
      expiresAt: Date.now() + 3600000,
      completedAt: null,
      [field]: field === "expiresAt" ? 1e30 : "secret-invalid-response",
    };
    const client = createPhoenixClient(
      config,
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(raw)),
    );
    await expect(client.find(id, 10000, pending.paymentHash)).rejects.toMatchObject({
      dependency: "phoenix",
      reason: field === "paymentHash" ? "mismatch" : "invalid_response",
    });
  },
);

test("configuration fails closed without printing invalid service credentials", () => {
  expect(() => parseConfig({ GATEWAY_TOKEN: "private" })).toThrow("Invalid GATEWAY_TOKEN");
  expect(() => parseConfig({ GATEWAY_TOKEN: "private" })).not.toThrow("private");
});

test("both stateless endpoints authenticate and validate requests; callbacks are removed", async () => {
  const phoenix = { create: vi.fn(async () => pending), find: vi.fn(async () => pending) };
  const app = gatewayWebHandler(config, phoenix);
  const call = (path: string, body: string, token = config.token) =>
    app.handler(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body,
      }),
    );
  try {
    for (const path of ["/v1/invoices", "/v1/payments/query"]) {
      const body = JSON.stringify({
        orderId: id,
        amountSat: 10000,
        paymentHash: pending.paymentHash,
      });
      expect((await call(path, body, "bad")).status).toBe(401);
      const invalid = await call(path, "{");
      expect(invalid.status).toBe(400);
      expect(Schema.decodeUnknownSync(PaymentProblem)(await invalid.json()).code).toBe(
        "INVALID_INPUT",
      );
      const response = await call(path, body);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(pending);
    }
    expect(phoenix.create).toHaveBeenCalledTimes(1);
    expect(phoenix.find).toHaveBeenCalledWith(id, 10000, pending.paymentHash);
    expect((await call("/v1/phoenix/webhook", "{}")).status).toBe(404);
  } finally {
    await app.dispose();
  }
});

test("create returns the newly generated hash without assuming externalId is unique", async () => {
  const raw = {
    externalId: id,
    requestedSat: 10000,
    receivedSat: 0,
    fees: 0,
    isPaid: false,
    paymentHash: pending.paymentHash,
    invoice: pending.invoice,
    expiresAt: Date.now() + 3600000,
    completedAt: null,
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ paymentHash: pending.paymentHash }))
    .mockResolvedValueOnce(Response.json(raw));
  const client = createPhoenixClient(config, fetcher);
  expect(await client.create(id, 10000)).toMatchObject({
    paymentHash: pending.paymentHash,
    paidAt: null,
  });
  expect(fetcher.mock.calls[1][0]).toContain(`/payments/incoming/${pending.paymentHash}`);
});
