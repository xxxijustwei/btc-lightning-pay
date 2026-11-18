import { expect, test, vi } from "vite-plus/test";
import type { InputType, Payment } from "@breeztech/breez-sdk-spark/nodejs";
import { createSparkWallet, type SparkSdk } from "./spark.ts";
import { walletWebHandler } from "./app.ts";
import { parseConfig } from "./config.ts";
const id = "12345678-1234-4234-8234-123456789abc";
const hash = "a".repeat(64);
const bolt11 = "lnbc100u1test";
const config = parseConfig({
  WALLET_TOKEN: "g".repeat(32),
  BREEZ_API_KEY: "test",
  BREEZ_MNEMONIC: "test",
  BREEZ_DATABASE_URL: "postgres://localhost/wallet",
  BREEZ_IDENTITY_PUBKEY: "02" + "a".repeat(64),
});
const parsed: InputType = {
  type: "bolt11Invoice",
  amountMsat: 10000000,
  description: `Order ${id}`,
  expiry: 3600,
  timestamp: 1700000000,
  invoice: { bolt11, source: {} },
  minFinalCltvExpiryDelta: 18,
  network: "bitcoin",
  payeePubkey: "test",
  paymentHash: hash,
  paymentSecret: "secret",
  routingHints: [],
};
const payment: Payment = {
  id: "spark-payment",
  paymentType: "receive",
  status: "completed",
  amount: 10000n,
  fees: 999n,
  timestamp: 1700000100,
  method: "lightning",
  details: {
    type: "lightning",
    invoice: bolt11,
    destinationPubkey: "test",
    htlcDetails: {
      paymentHash: hash,
      preimage: "never-export",
      expiryTime: 1700003600,
      status: "preimageShared",
    },
  },
};
function fixture(records: Payment[] = []) {
  const sdk = {
    getInfo: vi.fn<SparkSdk["getInfo"]>(async () => ({
      identityPubkey: config.identityPubkey,
      balanceSats: 0,
      tokenBalances: new Map(),
      recoverableFundsSats: 0,
      lastSyncedAt: Math.floor(Date.now() / 1000),
    })),
    receivePayment: vi.fn<SparkSdk["receivePayment"]>(async () => ({
      paymentRequest: bolt11,
      fee: 0n,
    })),
    parse: vi.fn<SparkSdk["parse"]>(async () => parsed),
    listPayments: vi.fn<SparkSdk["listPayments"]>(async () => ({ payments: records })),
  };
  return { sdk, wallet: createSparkWallet(sdk) };
}
test("creates fixed one-hour invoices; pending receipt has no fabricated amount", async () => {
  const { sdk, wallet } = fixture();
  const result = await wallet.create(id, 10000);
  expect(result).toMatchObject({ paymentHash: hash, paidAt: null, receivedMsat: null });
  expect(sdk.receivePayment).toHaveBeenCalledWith({
    paymentMethod: {
      type: "bolt11Invoice",
      description: `Order ${id}`,
      amountSats: 10000,
      expirySecs: 3600,
    },
  });
  expect(await wallet.find(id, 10000, hash, bolt11)).toEqual(result);
});
test("completed receipt uses SDK amount directly, strips fees and preimage, survives a fresh service", async () => {
  for (let i = 0; i < 2; i++) {
    const { wallet } = fixture([payment]);
    expect(await wallet.find(id, 10000, hash, bolt11)).toEqual({
      orderId: id,
      amountSat: 10000,
      paymentHash: hash,
      invoice: bolt11,
      expiresAt: new Date(1700003600000).toISOString(),
      paidAt: new Date(1700000100000).toISOString(),
      receivedMsat: 10000000,
    });
  }
});
test.each([{ amount: 9999n }, { paymentType: "send" as const }, { status: "pending" as const }])(
  "rejects mismatched payment facts",
  async (change) => {
    const { wallet } = fixture([{ ...payment, ...change }]);
    await expect(wallet.find(id, 10000, hash, bolt11)).rejects.toMatchObject({
      reason: "mismatch",
    });
  },
);
test("binds the invoice to the order, hash and amount", async () => {
  const { wallet } = fixture([payment]);
  await expect(wallet.find(crypto.randomUUID(), 10000, hash, bolt11)).rejects.toMatchObject({
    reason: "mismatch",
  });
  await expect(wallet.find(id, 10001, hash, bolt11)).rejects.toMatchObject({ reason: "mismatch" });
  await expect(wallet.find(id, 10000, "b".repeat(64), bolt11)).rejects.toMatchObject({
    reason: "mismatch",
  });
});
test("paginates SDK records and coalesces concurrent history reads", async () => {
  const { sdk, wallet } = fixture();
  const unrelated = { ...payment, details: undefined };
  sdk.listPayments
    .mockResolvedValueOnce({ payments: Array.from({ length: 500 }, () => unrelated) })
    .mockResolvedValueOnce({ payments: [payment] });
  const results = await Promise.all([
    wallet.find(id, 10000, hash, bolt11),
    wallet.find(id, 10000, hash, bolt11),
  ]);
  expect(results.every((r) => r.paidAt !== null)).toBe(true);
  expect(sdk.listPayments).toHaveBeenCalledTimes(2);
});
test("history failure is retryable and never becomes an unpaid verdict", async () => {
  const { sdk, wallet } = fixture([payment]);
  sdk.listPayments.mockRejectedValueOnce(new Error("offline"));
  await expect(wallet.find(id, 10000, hash, bolt11)).rejects.toThrow();
  expect((await wallet.find(id, 10000, hash, bolt11)).paidAt).not.toBeNull();
});
test("service HTTP endpoints require authentication and validate payloads", async () => {
  const { wallet } = fixture([payment]);
  const app = walletWebHandler(config, wallet);
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
        paymentHash: hash,
        invoice: bolt11,
      });
      expect((await call(path, body, "bad")).status).toBe(401);
      expect((await call(path, "{")).status).toBe(400);
      const response = await call(path, body);
      expect(response.status).toBe(200);
      expect(await response.json()).not.toHaveProperty("feeMsat");
    }
  } finally {
    await app.dispose();
  }
});
test("configuration fails closed without printing secrets", () => {
  expect(() => parseConfig({ WALLET_TOKEN: "private" })).toThrow("Invalid WALLET_TOKEN");
});

test("readiness rejects stale wallet synchronization", async () => {
  const { sdk, wallet } = fixture();
  expect(await wallet.ready()).toBe(true);
  sdk.getInfo.mockResolvedValueOnce({
    identityPubkey: config.identityPubkey,
    balanceSats: 0,
    tokenBalances: new Map(),
    recoverableFundsSats: 0,
    lastSyncedAt: 1,
  });
  expect(await wallet.ready()).toBe(false);
});
