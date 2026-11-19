import {
  WalletApi,
  type WalletCompletedPage,
  type WalletLookup,
  type WalletPayment,
  type WalletRequest,
} from "@btc-lightning-pay/api";
import { Cause, Context, Effect } from "effect";
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { PaymentFailure, UpstreamFailure } from "./errors";

type Payment = typeof WalletPayment.Type;
type Failure = Effect.Effect<never, UpstreamFailure>;

/**
 * The platform wallet as the Worker sees it. It reports facts as the wallet states them; checking
 * them against orders is Crediting's job. `mismatch` means the wallet itself refused a fact as
 * contradicting its order (HTTP 409). Failures are always `UpstreamFailure`, and an unusable
 * configuration fails every call as `not_configured` instead of preventing the build.
 */
export class Wallet extends Context.Service<
  Wallet,
  {
    /** Issues an order's one-hour invoice. */
    readonly issueInvoice: (
      request: typeof WalletRequest.Type,
    ) => Effect.Effect<Payment, UpstreamFailure>;
    /** Reports whether an issued invoice was paid. */
    readonly lookup: (request: typeof WalletLookup.Type) => Effect.Effect<Payment, UpstreamFailure>;
    /** One page of receipts completed at or after `since` (Unix seconds), oldest first. */
    readonly completedSince: (
      since: number,
    ) => Effect.Effect<typeof WalletCompletedPage.Type, UpstreamFailure>;
  }
>()("backend/Wallet") {}

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

const failure = (reason: UpstreamFailure["reason"], upstreamStatus?: number) =>
  new UpstreamFailure({ dependency: "wallet", reason, upstreamStatus });

/** Longer waits belong to a wallet that is down; the reservation is released instead. */
const WALLET_TIMEOUT = "15 seconds";

/** The HTTP adapter, driven by the WalletApi contract. */
function httpWallet(config: WalletConfig, requestId: string | undefined, fetcher: typeof fetch) {
  const headers = { ...config.headers, ...(requestId ? { "x-request-id": requestId } : {}) };
  const client = Effect.gen(function* () {
    const http = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(HttpClientRequest.setHeaders(headers)),
      // The wallet answers 409 when a receipt contradicts its order: an anomaly, not an outage.
      HttpClient.transformResponse(
        Effect.flatMap((response) =>
          response.status === 409
            ? Effect.fail(failure("mismatch", 409))
            : response.status < 200 || response.status > 299
              ? Effect.fail(failure("http", response.status))
              : Effect.succeed(response),
        ),
      ),
    );
    return yield* HttpApiClient.makeWith(WalletApi, { httpClient: http, baseUrl: config.origin });
  }).pipe(Effect.provide(FetchHttpClient.layer));
  const call = <A>(
    request: (wallet: Effect.Success<typeof client>["wallet"]) => Effect.Effect<A, unknown>,
  ) =>
    client.pipe(
      Effect.flatMap((wallet) => request(wallet.wallet)),
      // The fetch client reads both from the fiber that sends the request.
      Effect.provideService(FetchHttpClient.Fetch, fetcher),
      // A redirect would carry the bearer token elsewhere; it is answered as an HTTP failure.
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
      Effect.timeout(WALLET_TIMEOUT),
      Effect.mapError((error) =>
        error instanceof UpstreamFailure
          ? error
          : Cause.isTimeoutError(error)
            ? failure("timeout")
            : isTransportError(error)
              ? failure("network")
              : failure("invalid_response"),
      ),
    );
  return {
    issueInvoice: (payload) => call((wallet) => wallet.create({ payload })),
    lookup: (payload) => call((wallet) => wallet.lookup({ payload })),
    completedSince: (since) => call((wallet) => wallet.completed({ payload: { since } })),
  } satisfies typeof Wallet.Service;
}
const isTransportError = (error: unknown) =>
  HttpClientError.isHttpClientError(error) && error.reason._tag === "TransportError";

/** The configured wallet, or one whose every call fails `not_configured` when `config` is absent. */
export function makeWallet(
  config: WalletConfig | undefined,
  options: { requestId?: string; fetcher?: typeof fetch } = {},
): typeof Wallet.Service {
  if (config) return httpWallet(config, options.requestId, options.fetcher ?? globalThis.fetch);
  const unconfigured: Failure = Effect.fail(failure("not_configured"));
  return {
    issueInvoice: () => unconfigured,
    lookup: () => unconfigured,
    completedSince: () => unconfigured,
  };
}
