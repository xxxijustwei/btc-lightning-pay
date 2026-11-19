import { expect, test, vi } from "vite-plus/test";
import type { InputType, Payment } from "@breeztech/breez-sdk-spark/nodejs";
import { createSparkWallet, type SparkSdk } from "./spark.ts";
import { walletWebHandler } from "./app.ts";
import { parseConfig, readSecret } from "./config.ts";
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
test("an overpaid invoice is paid and reports the full amount received", async () => {
  const { wallet } = fixture([{ ...payment, amount: 12000n }]);
  expect(await wallet.find(id, 10000, hash, bolt11)).toMatchObject({
    amountSat: 10000,
    receivedMsat: 12000000,
  });
});
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
test("a lookup reads only the invoice's lifetime, page by page", async () => {
  const { sdk, wallet } = fixture();
  const unrelated = { ...payment, details: undefined };
  sdk.listPayments
    .mockResolvedValueOnce({ payments: Array.from({ length: 500 }, () => unrelated) })
    .mockResolvedValueOnce({ payments: [payment] });
  expect((await wallet.find(id, 10000, hash, bolt11)).paidAt).not.toBeNull();
  expect(sdk.listPayments).toHaveBeenCalledTimes(2);
  expect(sdk.listPayments).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      fromTimestamp: 1700000000 - 60,
      toTimestamp: 1700003600 + 300,
      offset: 500,
    }),
  );
});
test("a duplicated payment hash fails only its own order", async () => {
  const { wallet } = fixture([payment, { ...payment, id: "copy" }]);
  await expect(wallet.find(id, 10000, hash, bolt11)).rejects.toMatchObject({ reason: "mismatch" });
});
test("history failure is retryable and never becomes an unpaid verdict", async () => {
  const { sdk, wallet } = fixture([payment]);
  sdk.listPayments.mockRejectedValueOnce(new Error("offline"));
  await expect(wallet.find(id, 10000, hash, bolt11)).rejects.toThrow();
  expect((await wallet.find(id, 10000, hash, bolt11)).paidAt).not.toBeNull();
});
test("completed receipts list order payments since a time and skip foreign or bad receipts", async () => {
  const foreign = { ...payment, id: "foreign", timestamp: 1700000200 };
  const short = { ...payment, id: "short", amount: 9000n, timestamp: 1700000300 };
  const { sdk, wallet } = fixture([payment, foreign, short]);
  sdk.parse.mockImplementation(async () => parsed);
  sdk.parse
    .mockResolvedValueOnce(parsed)
    .mockResolvedValueOnce(parsed)
    .mockResolvedValueOnce({
      ...parsed,
      description: "tip jar",
    });
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const page = await wallet.completed(1700000000);
    expect(page).toEqual({
      payments: [expect.objectContaining({ orderId: id, receivedMsat: 10000000 })],
      latest: 1700000300,
      more: false,
    });
    expect(sdk.listPayments).toHaveBeenCalledWith(
      expect.objectContaining({ fromTimestamp: 1700000000, offset: 0, limit: 500 }),
    );
    // The short receipt is an anomaly, logged without failing the page.
    expect(error).toHaveBeenCalledWith(expect.stringContaining("payment_anomaly"));
  } finally {
    error.mockRestore();
  }
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
    const completed = await call("/v1/payments/completed", JSON.stringify({ since: 0 }), "bad");
    expect(completed.status).toBe(401);
    expect((await call("/v1/payments/completed", JSON.stringify({ since: 0 }))).status).toBe(200);
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
test("the mnemonic can come from a mounted secret file, but not from both sources", () => {
  const read = vi.fn(() => "file words\n");
  expect(readSecret({ BREEZ_MNEMONIC_FILE: "/run/secrets/m" }, "BREEZ_MNEMONIC", read)).toBe(
    "file words",
  );
  expect(() =>
    readSecret({ BREEZ_MNEMONIC_FILE: "/x", BREEZ_MNEMONIC: "env" }, "BREEZ_MNEMONIC", read),
  ).toThrow("Set only one");
  expect(() =>
    readSecret({ BREEZ_MNEMONIC_FILE: "/x" }, "BREEZ_MNEMONIC", () => {
      throw new Error("ENOENT");
    }),
  ).toThrow("Unreadable BREEZ_MNEMONIC_FILE");
});
test("a mismatched receipt answers 409 PAYMENT_MISMATCH, not an outage", async () => {
  const { wallet } = fixture([{ ...payment, amount: 1n }]);
  const app = walletWebHandler(config, wallet);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await app.handler(
      new Request("http://localhost/v1/payments/query", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ orderId: id, amountSat: 10000, paymentHash: hash, invoice: bolt11 }),
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "PAYMENT_MISMATCH" });
  } finally {
    error.mockRestore();
    await app.dispose();
  }
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
