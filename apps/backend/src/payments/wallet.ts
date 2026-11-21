import {
  WalletApi,
  type PaymentErrorCode,
  type PayoutRoutes,
  type WalletBalance,
  type WalletPayoutQuote,
  type WalletPayoutQuoteRequest,
  type WalletPayoutState,
  type WalletCompletedPage,
  type WalletLookup,
  type WalletPayment,
  type WalletRequest,
} from "@btc-lightning-pay/api";
import { Cause, Context, Effect } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { PaymentFailure, UpstreamFailure } from "./errors";

/** Codes with which the wallet refuses a payout before any funds move. */
const PAYOUT_REFUSALS = new Set([
  "AMOUNT_OUT_OF_RANGE",
  "ROUTE_UNAVAILABLE",
  "ADDRESS_NETWORK_MISMATCH",
  "PAYOUT_ADDRESS_INVALID",
  "INSUFFICIENT_BALANCE",
  "QUOTE_EXPIRED",
]);

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
    readonly balance: () => Effect.Effect<typeof WalletBalance.Type, UpstreamFailure>;
    readonly payoutRoutes: () => Effect.Effect<typeof PayoutRoutes.Type, UpstreamFailure>;
    /** Payout calls fail `PaymentFailure` when the wallet refused before any funds moved. */
    readonly quotePayout: (
      request: typeof WalletPayoutQuoteRequest.Type,
    ) => Effect.Effect<typeof WalletPayoutQuote.Type, UpstreamFailure | PaymentFailure>;
    readonly sendPayout: (
      payoutId: string,
    ) => Effect.Effect<{ readonly paymentId: string }, UpstreamFailure | PaymentFailure>;
    readonly payoutStatus: (
      payoutId: string,
      paymentId: string | null,
    ) => Effect.Effect<typeof WalletPayoutState.Type, UpstreamFailure>;
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

/** A payout the wallet refused before any funds moved, as its 400/409 body names it. */
class Refused extends Error {
  constructor(readonly code: PaymentErrorCode) {
    super(code);
  }
}

/** The HTTP adapter, driven by the WalletApi contract. */
function httpWallet(config: WalletConfig, requestId: string | undefined, fetcher: typeof fetch) {
  const headers = { ...config.headers, ...(requestId ? { "x-request-id": requestId } : {}) };
  const client = Effect.gen(function* () {
    const http = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(HttpClientRequest.setHeaders(headers)),
      // The wallet answers 409 when a receipt contradicts its order: an anomaly, not an outage.
      // A payout refusal carries its code in the body; anything else is an HTTP failure.
      HttpClient.transformResponse(
        Effect.flatMap(
          (
            response,
          ): Effect.Effect<HttpClientResponse.HttpClientResponse, UpstreamFailure | Refused> => {
            if (response.status >= 200 && response.status <= 299) return Effect.succeed(response);
            const fallback = failure(
              response.status === 409 ? "mismatch" : "http",
              response.status,
            );
            if (response.status !== 400 && response.status !== 409) return Effect.fail(fallback);
            return response.json.pipe(
              Effect.orElseSucceed(() => undefined),
              Effect.flatMap((body) => {
                const code = (body as { code?: unknown } | undefined)?.code;
                return Effect.fail(
                  typeof code === "string" && PAYOUT_REFUSALS.has(code)
                    ? new Refused(code as PaymentErrorCode)
                    : fallback,
                );
              }),
            );
          },
        ),
      ),
    );
    return yield* HttpApiClient.makeWith(WalletApi, { httpClient: http, baseUrl: config.origin });
  }).pipe(Effect.provide(FetchHttpClient.layer));
  type Client = Effect.Success<typeof client>["wallet"];
  const send = <A>(request: (wallet: Client) => Effect.Effect<A, unknown>) =>
    client.pipe(
      Effect.flatMap((wallet) => request(wallet.wallet)),
      // The fetch client reads both from the fiber that sends the request.
      Effect.provideService(FetchHttpClient.Fetch, fetcher),
      // A redirect would carry the bearer token elsewhere; it is answered as an HTTP failure.
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
      Effect.timeout(WALLET_TIMEOUT),
    );
  const upstream = (error: unknown) =>
    error instanceof UpstreamFailure
      ? error
      : Cause.isTimeoutError(error)
        ? failure("timeout")
        : isTransportError(error)
          ? failure("network")
          : failure("invalid_response");
  const call = <A>(request: (wallet: Client) => Effect.Effect<A, unknown>) =>
    send(request).pipe(
      Effect.mapError((error) => (error instanceof Refused ? failure("http") : upstream(error))),
    );
  const payoutCall = <A>(request: (wallet: Client) => Effect.Effect<A, unknown>) =>
    send(request).pipe(
      Effect.mapError((error) =>
        error instanceof Refused ? new PaymentFailure({ code: error.code }) : upstream(error),
      ),
    );
  return {
    issueInvoice: (payload) => call((wallet) => wallet.create({ payload })),
    lookup: (payload) => call((wallet) => wallet.lookup({ payload })),
    completedSince: (since) => call((wallet) => wallet.completed({ payload: { since } })),
    balance: () => call((wallet) => wallet.balance()),
    payoutRoutes: () => call((wallet) => wallet.payoutRoutes()),
    quotePayout: (payload) => payoutCall((wallet) => wallet.quotePayout({ payload })),
    sendPayout: (payoutId) => payoutCall((wallet) => wallet.sendPayout({ payload: { payoutId } })),
    payoutStatus: (payoutId, paymentId) =>
      call((wallet) => wallet.payoutStatus({ payload: { payoutId, paymentId } })),
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
    balance: () => unconfigured,
    payoutRoutes: () => unconfigured,
    quotePayout: () => unconfigured,
    sendPayout: () => unconfigured,
    payoutStatus: () => unconfigured,
  };
}
