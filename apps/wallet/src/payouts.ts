import type {
  BreezSdk,
  CrossChainAddressFamily,
  CrossChainRoutePair,
  Payment,
  PrepareSendPaymentResponse,
} from "@breeztech/breez-sdk-spark/nodejs";
import type {
  PayoutRoute,
  WalletPayoutQuote,
  WalletPayoutQuoteRequest,
  WalletPayoutState,
} from "@btc-lightning-pay/api/payments";
import type { PaymentErrorCode } from "@btc-lightning-pay/api/payments";

export type PayoutSdk = Pick<
  BreezSdk,
  | "getInfo"
  | "parse"
  | "getCrossChainRoutes"
  | "prepareSendPayment"
  | "sendPayment"
  | "getPayment"
  | "refundPendingConversions"
>;
type Route = typeof PayoutRoute.Type;
type QuoteRequest = typeof WalletPayoutQuoteRequest.Type;

/** A payout the wallet refused before any funds moved; answered with `code`. */
export class PayoutRejected extends Error {
  constructor(readonly code: PaymentErrorCode) {
    super(code);
  }
}

const ASSETS = new Set(["USDC", "USDT"]);
/**
 * Ordinary-looking addresses for listing routes before the real recipient is known. Routes do not
 * depend on the recipient; a quote does, and token contracts or burn addresses are refused there.
 */
const PLACEHOLDERS: [CrossChainAddressFamily, string][] = [
  ["evm", "0x000000000000000000000000000000000000dEaD"],
  ["solana", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"],
  ["tron", "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"],
];
const ROUTES_TTL_MS = 10 * 60_000;

const btcLimits = (route: CrossChainRoutePair) =>
  route.acceptedAssets.find(({ asset }) => asset.type === "bitcoin");
const toInt = (value: bigint | number | undefined) => (value === undefined ? null : Number(value));

function describe(route: CrossChainRoutePair, family: CrossChainAddressFamily): Route | undefined {
  const asset = route.asset.toUpperCase();
  const btc = btcLimits(route);
  if (!btc || !ASSETS.has(asset) || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(route.chain)) return;
  return {
    chain: route.chain,
    chainId: route.chainId ?? null,
    asset: asset as Route["asset"],
    contract: route.contractAddress ?? null,
    decimals: route.decimals,
    addressFamily: family,
    minSat: toInt(btc.limits?.minAmount),
    maxSat: toInt(btc.limits?.maxAmount),
    minUsdCents: toInt(btc.limits?.minUsdCents),
    maxUsdCents: toInt(btc.limits?.maxUsdCents),
  };
}

/** Maps an SDK refusal at prepare time; its errors carry only a message. */
function quoteRejection(error: unknown): PayoutRejected {
  const message = error instanceof Error ? error.message : String(error);
  if (/out of range|too small|too large|below|exceed/i.test(message))
    return new PayoutRejected("AMOUNT_OUT_OF_RANGE");
  if (/recipient|address|contract/i.test(message))
    return new PayoutRejected("PAYOUT_ADDRESS_INVALID");
  return new PayoutRejected("ROUTE_UNAVAILABLE");
}

function conversionOf(payment: Payment) {
  const details = payment.details;
  const info = details && "conversionInfo" in details ? details.conversionInfo : undefined;
  return info && info.type !== "amm" ? info : undefined;
}

/** Where `payment` stands from the payout's point of view. */
export function payoutState(payment: Payment): typeof WalletPayoutState.Type {
  const conversion = conversionOf(payment);
  const base = { paymentId: payment.id, deliveredOut: null, externalTx: null };
  if (payment.status === "failed") return { ...base, state: "failed" };
  switch (conversion?.status) {
    case "completed":
      return {
        ...base,
        state: "completed",
        deliveredOut: (conversion.deliveredAmount ?? conversion.estimatedOut).toString(),
        externalTx: conversion.type === "orchestra" ? (conversion.externalTxHash ?? null) : null,
      };
    case "refunded":
      return { ...base, state: "refunded" };
    case "failed":
      return { ...base, state: "failed" };
    default:
      // Pending, a refund in progress, or a Spark transfer the provider has not reported yet.
      return { ...base, state: "pending" };
  }
}

/**
 * Cross-chain payouts from the BTC balance. Quotes live in memory until they expire, so a restart
 * asks for a new quote; a sent payout's payment id is its payout id.
 */
export function createPayouts(sdk: PayoutSdk, now: () => number = Date.now) {
  let cached: { at: number; routes: Route[] } | undefined;
  const quotes = new Map<
    string,
    { prepared: PrepareSendPaymentResponse; amountSat: number; expiresAt: number }
  >();
  const prune = () => {
    for (const [id, quote] of quotes) if (quote.expiresAt <= now()) quotes.delete(id);
  };
  async function balance() {
    const info = await sdk.getInfo({});
    return { balanceSat: info.balanceSats };
  }
  async function routes() {
    if (cached && now() - cached.at < ROUTES_TTL_MS) return { routes: cached.routes };
    const found = new Map<string, Route>();
    for (const [family, address] of PLACEHOLDERS) {
      const pairs = await sdk.getCrossChainRoutes({
        type: "send",
        addressDetails: { address, addressFamily: family },
      });
      for (const pair of pairs) {
        const route = describe(pair, family);
        if (route && !found.has(`${route.chain}:${route.asset}`))
          found.set(`${route.chain}:${route.asset}`, route);
      }
    }
    cached = { at: now(), routes: [...found.values()] };
    return { routes: cached.routes };
  }
  async function quote(request: QuoteRequest): Promise<typeof WalletPayoutQuote.Type> {
    prune();
    const route = (await routes()).routes.find(
      (item) => item.chain === request.chain && item.asset === request.asset,
    );
    if (!route) throw new PayoutRejected("ROUTE_UNAVAILABLE");
    if ((await balance()).balanceSat < request.amountSat)
      throw new PayoutRejected("INSUFFICIENT_BALANCE");
    const parsed = await sdk.parse(request.address).catch(() => undefined);
    if (parsed?.type !== "crossChainAddress") throw new PayoutRejected("PAYOUT_ADDRESS_INVALID");
    if (parsed.addressFamily !== route.addressFamily)
      throw new PayoutRejected("ADDRESS_NETWORK_MISMATCH");
    const pairs = await sdk.getCrossChainRoutes({
      type: "send",
      addressDetails: { address: parsed.address, addressFamily: parsed.addressFamily },
    });
    const candidates = pairs.filter(
      (pair) =>
        pair.chain === route.chain &&
        pair.asset.toUpperCase() === route.asset &&
        btcLimits(pair) !== undefined,
    );
    if (!candidates.length) throw new PayoutRejected("ROUTE_UNAVAILABLE");
    let best: { pair: CrossChainRoutePair; prepared: PrepareSendPaymentResponse } | undefined;
    let rejection: PayoutRejected | undefined;
    for (const pair of candidates) {
      try {
        const prepared = await sdk.prepareSendPayment({
          paymentRequest: { type: "crossChain", address: parsed.address, route: pair },
          amount: BigInt(request.amountSat),
          feePolicy: "feesIncluded",
        });
        const method = prepared.paymentMethod;
        // Fees come out of the amount, so the wallet sends exactly the settlement's sats.
        if (method.type !== "crossChainAddress" || method.amountIn !== BigInt(request.amountSat))
          continue;
        const current = best?.prepared.paymentMethod;
        if (
          !current ||
          (current.type === "crossChainAddress" && method.estimatedOut > current.estimatedOut)
        )
          best = { pair, prepared };
      } catch (error) {
        rejection ??= quoteRejection(error);
      }
    }
    const method = best?.prepared.paymentMethod;
    if (!best || method?.type !== "crossChainAddress")
      throw rejection ?? new PayoutRejected("ROUTE_UNAVAILABLE");
    const expiresAt = Date.parse(method.expiresAt);
    quotes.set(request.payoutId, {
      prepared: best.prepared,
      amountSat: request.amountSat,
      expiresAt,
    });
    const context = method.providerContext;
    return {
      payoutId: request.payoutId,
      provider: best.pair.provider,
      providerRef: context.type === "orchestra" ? context.quoteId : context.swapId,
      chain: route.chain,
      chainId: best.pair.chainId ?? null,
      asset: route.asset,
      contract: best.pair.contractAddress ?? null,
      decimals: best.pair.decimals,
      valueOut: method.assetAmountIn.toString(),
      feeOut: method.feeAmount.toString(),
      estimatedOut: method.estimatedOut.toString(),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }
  /** Sends a held quote once; any failure after the call starts leaves the outcome unknown. */
  async function send(payoutId: string) {
    prune();
    const held = quotes.get(payoutId);
    if (!held) throw new PayoutRejected("QUOTE_EXPIRED");
    if ((await balance()).balanceSat < held.amountSat)
      throw new PayoutRejected("INSUFFICIENT_BALANCE");
    quotes.delete(payoutId);
    const { payment } = await sdk.sendPayment({
      prepareResponse: held.prepared,
      idempotencyKey: payoutId,
    });
    return { paymentId: payment.id };
  }
  async function status(payoutId: string, paymentId: string | null) {
    for (const id of new Set([paymentId ?? payoutId, payoutId])) {
      const payment = await sdk
        .getPayment({ paymentId: id })
        .then((response) => response.payment)
        .catch(() => undefined);
      if (!payment) continue;
      if (conversionOf(payment)?.status === "refundNeeded")
        await sdk.refundPendingConversions().catch(() => undefined);
      return payoutState(payment);
    }
    return { state: "missing" as const, paymentId: null, deliveredOut: null, externalTx: null };
  }
  return { balance, routes, quote, send, status };
}
