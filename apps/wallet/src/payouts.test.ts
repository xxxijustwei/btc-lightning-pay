import { expect, test, vi } from "vite-plus/test";
import type {
  CrossChainRoutePair,
  Payment,
  PrepareSendPaymentRequest,
  PrepareSendPaymentResponse,
} from "@breeztech/breez-sdk-spark/nodejs";
import { Sats } from "@btc-lightning-pay/api";
import { walletWebHandler } from "./app.ts";
import { parseConfig } from "./config.ts";
import { createPayouts, PayoutRejected, type PayoutSdk } from "./payouts.ts";
import { createSparkWallet, type SparkSdk } from "./spark.ts";

const payoutId = "12345678-1234-4234-8234-123456789abc";
const recipient = "0x1111111111111111111111111111111111111111";
const limits = { minAmount: 1200n, minUsdCents: 80, maxUsdCents: 14410000 };
const route = (chain: string, asset: string, extra: Partial<CrossChainRoutePair> = {}) =>
  ({
    provider: "orchestra",
    chain,
    chainId: "8453",
    asset,
    contractAddress: `0x${chain}${asset}`,
    decimals: 6,
    exactOutEligible: false,
    acceptedAssets: [{ asset: { type: "bitcoin" }, limits }],
    deliveryMethods: ["spark"],
    ...extra,
  }) as CrossChainRoutePair;
const evmRoutes = [
  route("base", "USDC"),
  route("base", "USDC", { provider: "boltz" }),
  route("arc", "USDC", { acceptedAssets: [{ asset: { type: "token", tokenIdentifier: "x" } }] }),
  route("base", "EURC"),
];

function prepared(amount: bigint, estimatedOut: bigint, provider = "orchestra") {
  return {
    amount,
    feePolicy: "feesIncluded",
    paymentMethod: {
      type: "crossChainAddress",
      route: route("base", "USDC"),
      recipientAddress: recipient,
      amountIn: amount,
      assetAmountIn: 57_886_950n,
      estimatedOut,
      feeAmount: 57_886_950n - estimatedOut,
      serviceFeeAmount: 1n,
      sourceTransferFeeSats: 0,
      feeMode: "feesIncluded",
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      providerContext:
        provider === "orchestra"
          ? { type: "orchestra", quoteId: "q-1", depositAddress: "spark1x" }
          : { type: "boltz", swapId: "s-1", invoice: "lnbc1", maxSlippageBps: 100 },
    },
  } as PrepareSendPaymentResponse;
}

function sendPayment(
  id: string,
  details?: Payment["details"],
  status: Payment["status"] = "pending",
) {
  return {
    id,
    paymentType: "send",
    status,
    amount: 100_000n,
    fees: 0n,
    timestamp: 1,
    method: "spark",
    details,
  } as Payment;
}
const orchestra = (status: string, extra = {}) =>
  ({
    type: "spark",
    conversionInfo: {
      type: "orchestra",
      chain: "base",
      recipientAddress: recipient,
      estimatedOut: 57_590_000n,
      status,
      assetDecimals: 6,
      orderId: "o",
      quoteId: "q-1",
      ...extra,
    },
  }) as Payment["details"];

function fixture(balanceSats = 500_000) {
  const sdk = {
    getInfo: vi.fn(async () => ({ balanceSats })),
    parse: vi.fn(async (input: string) =>
      input.startsWith("0x")
        ? { type: "crossChainAddress", address: input, addressFamily: "evm" }
        : input.startsWith("T")
          ? { type: "crossChainAddress", address: input, addressFamily: "tron" }
          : { type: "bolt11Invoice" },
    ),
    getCrossChainRoutes: vi.fn(async (filter: { addressDetails: { addressFamily: string } }) =>
      filter.addressDetails.addressFamily === "evm"
        ? evmRoutes
        : filter.addressDetails.addressFamily === "tron"
          ? [route("tron", "USDT", { chainId: "728126428" })]
          : [],
    ),
    prepareSendPayment: vi.fn(async (request: PrepareSendPaymentRequest) =>
      request.paymentRequest.type === "crossChain" &&
      request.paymentRequest.route.provider === "boltz"
        ? prepared(request.amount!, 57_000_000n, "boltz")
        : prepared(request.amount!, 57_590_000n),
    ),
    sendPayment: vi.fn(async () => ({ payment: sendPayment(payoutId) })),
    getPayment: vi.fn(async (): Promise<{ payment: Payment }> => {
      throw new Error("Payment not found");
    }),
    refundPendingConversions: vi.fn(async () => ({})),
  };
  let now = Date.now();
  const payouts = createPayouts(sdk as unknown as PayoutSdk, () => now);
  return { sdk, payouts, advance: (ms: number) => (now += ms) };
}
const request = {
  payoutId,
  chain: "base",
  asset: "USDC" as const,
  address: recipient,
  amountSat: Sats.make(100_000),
};
const rejected = (code: string) => expect.objectContaining({ code });

test("lists BTC-funded USDC/USDT routes once per chain and asset, cached for ten minutes", async () => {
  const { sdk, payouts, advance } = fixture();
  const { routes } = await payouts.routes();
  expect(routes).toEqual([
    expect.objectContaining({ chain: "base", asset: "USDC", addressFamily: "evm", minSat: 1200 }),
    expect.objectContaining({ chain: "tron", asset: "USDT", addressFamily: "tron", maxSat: null }),
  ]);
  await payouts.routes();
  expect(sdk.getCrossChainRoutes).toHaveBeenCalledTimes(3);
  advance(10 * 60_000);
  await payouts.routes();
  expect(sdk.getCrossChainRoutes).toHaveBeenCalledTimes(6);
});

test("quotes with fees taken from the amount and keeps the best provider", async () => {
  const { sdk, payouts } = fixture();
  const quote = await payouts.quote(request);
  expect(quote).toMatchObject({
    provider: "orchestra",
    providerRef: "q-1",
    valueOut: "57886950",
    feeOut: "296950",
    estimatedOut: "57590000",
  });
  expect(sdk.prepareSendPayment).toHaveBeenCalledWith(
    expect.objectContaining({ amount: 100_000n, feePolicy: "feesIncluded" }),
  );
});

test("refuses quotes before any funds could move", async () => {
  await expect(fixture(99_999).payouts.quote(request)).rejects.toEqual(
    rejected("INSUFFICIENT_BALANCE"),
  );
  const { payouts, sdk } = fixture();
  await expect(
    payouts.quote({ ...request, address: "TXYZ1111111111111111111111" }),
  ).rejects.toEqual(rejected("ADDRESS_NETWORK_MISMATCH"));
  await expect(payouts.quote({ ...request, address: "lnbc1qqqqqqqqqqqqqqqqqqqq" })).rejects.toEqual(
    rejected("PAYOUT_ADDRESS_INVALID"),
  );
  await expect(payouts.quote({ ...request, chain: "ethereum" })).rejects.toEqual(
    rejected("ROUTE_UNAVAILABLE"),
  );
  sdk.prepareSendPayment.mockRejectedValue(
    new Error("Invalid input: Recipient address is the USDT token contract on base."),
  );
  await expect(payouts.quote(request)).rejects.toEqual(rejected("PAYOUT_ADDRESS_INVALID"));
  sdk.prepareSendPayment.mockRejectedValue(new Error("Cross-chain amount out of range: too small"));
  await expect(payouts.quote(request)).rejects.toEqual(rejected("AMOUNT_OUT_OF_RANGE"));
  // A quote that would send more than the amount (fees on top) is never offered.
  sdk.prepareSendPayment.mockResolvedValue(prepared(100_500n, 57_590_000n));
  await expect(payouts.quote(request)).rejects.toEqual(rejected("ROUTE_UNAVAILABLE"));
});

test("sends a held quote once, keyed by the payout id", async () => {
  const { sdk, payouts, advance } = fixture();
  await payouts.quote(request);
  expect(await payouts.send(payoutId)).toEqual({ paymentId: payoutId });
  expect(sdk.sendPayment).toHaveBeenCalledWith(
    expect.objectContaining({ idempotencyKey: payoutId }),
  );
  await expect(payouts.send(payoutId)).rejects.toEqual(rejected("QUOTE_EXPIRED"));
  await payouts.quote(request);
  advance(121_000);
  await expect(payouts.send(payoutId)).rejects.toEqual(rejected("QUOTE_EXPIRED"));
  expect(sdk.sendPayment).toHaveBeenCalledTimes(1);
});

test("reports payout state from the payment and its conversion", async () => {
  const { sdk, payouts } = fixture();
  expect(await payouts.status(payoutId, null)).toMatchObject({ state: "missing" });
  sdk.getPayment.mockResolvedValue({ payment: sendPayment(payoutId, orchestra("pending")) });
  expect(await payouts.status(payoutId, null)).toMatchObject({ state: "pending" });
  sdk.getPayment.mockResolvedValue({ payment: sendPayment(payoutId, orchestra("refundNeeded")) });
  expect(await payouts.status(payoutId, null)).toMatchObject({ state: "pending" });
  expect(sdk.refundPendingConversions).toHaveBeenCalledOnce();
  sdk.getPayment.mockResolvedValue({ payment: sendPayment(payoutId, orchestra("refunded")) });
  expect(await payouts.status(payoutId, null)).toMatchObject({ state: "refunded" });
  sdk.getPayment.mockResolvedValue({
    payment: sendPayment(
      payoutId,
      orchestra("completed", { deliveredAmount: 57_600_000n, externalTxHash: "0xabc" }),
      "completed",
    ),
  });
  expect(await payouts.status(payoutId, null)).toEqual({
    state: "completed",
    paymentId: payoutId,
    deliveredOut: "57600000",
    externalTx: "0xabc",
  });
  sdk.getPayment.mockResolvedValue({ payment: sendPayment(payoutId, undefined, "failed") });
  expect(await payouts.status(payoutId, null)).toMatchObject({ state: "failed" });
});

test("payout endpoints answer refusals with their code and outages as WALLET_UNAVAILABLE", async () => {
  const config = parseConfig({
    WALLET_TOKEN: "g".repeat(32),
    BREEZ_API_KEY: "test",
    BREEZ_MNEMONIC: "test",
    BREEZ_DATABASE_URL: "postgres://localhost/wallet",
    BREEZ_IDENTITY_PUBKEY: "02" + "a".repeat(64),
  });
  const { sdk, payouts } = fixture(10);
  const app = walletWebHandler(config, {
    ...createSparkWallet({} as SparkSdk),
    payouts,
  });
  const call = (path: string, body?: unknown) =>
    app.handler(
      new Request(`http://localhost${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await (await call("/v1/balance")).json()).toEqual({ balanceSat: 10 });
    expect((await call("/v1/payouts/routes")).status).toBe(200);
    const low = await call("/v1/payouts/quote", request);
    expect(low.status).toBe(409);
    expect(await low.json()).toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    const expired = await call("/v1/payouts/send", { payoutId });
    expect(await expired.json()).toMatchObject({ code: "QUOTE_EXPIRED" });
    sdk.getPayment.mockRejectedValue(new Error("boom"));
    sdk.getInfo.mockRejectedValue(new Error("offline"));
    const down = await call("/v1/balance");
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ code: "WALLET_UNAVAILABLE" });
    expect(new PayoutRejected("QUOTE_EXPIRED").code).toBe("QUOTE_EXPIRED");
  } finally {
    error.mockRestore();
    await app.dispose();
  }
});
