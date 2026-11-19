import { WalletCompletedPage, WalletPayment } from "@btc-lightning-pay/api";
import { Schema } from "effect";
import { PaymentFailure, UpstreamFailure } from "./errors";

export type WalletBindings = {
  APP_ENV?: string;
  WALLET_URL?: string;
  WALLET_TOKEN?: string;
  /** Cloudflare Access service token in front of the wallet; required in production. */
  WALLET_ACCESS_CLIENT_ID?: string;
  WALLET_ACCESS_CLIENT_SECRET?: string;
};
export type WalletConfig = { origin: string; headers: Record<string, string> };

/** Validates the wallet binding settings; throws WALLET_NOT_CONFIGURED when they are unusable. */
export function parseWalletConfig(env: WalletBindings): WalletConfig {
  const fail = () => new PaymentFailure({ code: "WALLET_NOT_CONFIGURED" });
  const token = env.WALLET_TOKEN ?? "";
  let target: URL;
  try {
    target = new URL(env.WALLET_URL ?? "");
  } catch {
    throw fail();
  }
  const local = target.protocol === "http:" && ["127.0.0.1", "localhost"].includes(target.hostname);
  if (
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash ||
    (target.protocol !== "https:" && !local) ||
    token.length < 32
  )
    throw fail();
  const clientId = env.WALLET_ACCESS_CLIENT_ID?.trim();
  const clientSecret = env.WALLET_ACCESS_CLIENT_SECRET?.trim();
  if (!clientId !== !clientSecret) throw fail();
  if (!clientId && (env.APP_ENV?.trim() || "production") === "production") throw fail();
  return {
    origin: target.origin,
    headers: {
      authorization: `Bearer ${token}`,
      ...(clientId && clientSecret
        ? { "cf-access-client-id": clientId, "cf-access-client-secret": clientSecret }
        : {}),
    },
  };
}

async function post(
  config: WalletConfig,
  path: string,
  body: unknown,
  fetcher: typeof fetch,
  signal: AbortSignal | undefined,
  requestId: string | undefined,
) {
  let response: Response;
  try {
    response = await fetcher(`${config.origin}${path}`, {
      method: "POST",
      headers: {
        ...config.headers,
        "content-type": "application/json",
        ...(requestId ? { "x-request-id": requestId } : {}),
      },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15_000)]),
    });
  } catch (error) {
    throw new UpstreamFailure({
      dependency: "wallet",
      reason: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network",
    });
  }
  // The wallet answers 409 when a receipt contradicts its order: an anomaly, not an outage.
  if (response.status === 409)
    throw new UpstreamFailure({ dependency: "wallet", reason: "mismatch", upstreamStatus: 409 });
  if (response.status !== 202 && !response.ok)
    throw new UpstreamFailure({
      dependency: "wallet",
      reason: "http",
      upstreamStatus: response.status,
    });
  return response;
}

/** Issues an invoice (no hash) or looks up the payment of an issued one. */
export function createWalletClient(
  config: WalletConfig,
  fetcher: typeof fetch = fetch,
  requestId?: string,
) {
  return async (
    orderId: string,
    amountSat: number,
    signal?: AbortSignal,
    paymentHash?: string,
    invoice?: string,
  ) => {
    const response = await post(
      config,
      paymentHash ? "/v1/payments/query" : "/v1/invoices",
      { orderId, amountSat, ...(paymentHash ? { paymentHash, invoice } : {}) },
      fetcher,
      signal,
      requestId,
    );
    if (response.status === 202) return null;
    let result;
    try {
      result = Schema.decodeUnknownSync(WalletPayment)(await response.json());
    } catch {
      throw new UpstreamFailure({ dependency: "wallet", reason: "invalid_response" });
    }
    if (
      result.orderId !== orderId ||
      result.amountSat !== amountSat ||
      (paymentHash && result.paymentHash !== paymentHash)
    )
      throw new UpstreamFailure({ dependency: "wallet", reason: "mismatch" });
    return result;
  };
}

/** Reads one page of completed receipts at or after `since` (Unix seconds). */
export function createWalletLister(config: WalletConfig, fetcher: typeof fetch = fetch) {
  return async (since: number, signal?: AbortSignal) => {
    const response = await post(
      config,
      "/v1/payments/completed",
      { since },
      fetcher,
      signal,
      undefined,
    );
    try {
      return Schema.decodeUnknownSync(WalletCompletedPage)(await response.json());
    } catch {
      throw new UpstreamFailure({ dependency: "wallet", reason: "invalid_response" });
    }
  };
}
export type WalletLister = ReturnType<typeof createWalletLister>;
