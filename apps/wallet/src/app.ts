import { timingSafeEqual } from "node:crypto";
import { WalletApi, WalletAuth } from "@btc-lightning-pay/api/payments";
import { Effect, Layer, Option, Redacted } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { HttpRouter, HttpServer, HttpServerRequest } from "effect/http";
import { Wallet } from "./wallet.ts";
import {
  WalletDependencyFailure,
  logWalletAnomaly,
  logWalletFailure,
  logWalletUnauthorized,
  walletErrorFields,
} from "./errors.ts";
import { walletTask } from "./runtime.ts";
import type { WalletConfig } from "./config.ts";
import { errorBoundary, problem, RequestTrace } from "./http.ts";

function equal(actual: string, expected: string) {
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
/** Checks the bearer token once for every endpoint that declares `WalletAuth`. */
const walletAuth = (token: string) =>
  Layer.succeed(WalletAuth, {
    bearer: (endpoint, { credential }) =>
      Effect.gen(function* () {
        if (equal(Redacted.value(credential), token)) return yield* endpoint;
        const request = yield* HttpServerRequest.HttpServerRequest;
        // RequestTrace is provided by the error boundary around every route.
        const trace = yield* Effect.serviceOption(RequestTrace);
        logWalletUnauthorized({
          path: new URL(request.url, "http://wallet").pathname,
          requestId: Option.getOrUndefined(trace)?.requestId,
        });
        return problem("UNAUTHORIZED");
      }),
  });
/**
 * Runs one wallet call: a receipt that contradicts its order answers 409, so the Worker never
 * mistakes it for an outage; any other failure is logged and answers 503.
 */
const walletCall = <A>(
  operation: string,
  orderId: string | undefined,
  work: (wallet: typeof Wallet.Service) => Promise<A>,
) =>
  Effect.gen(function* () {
    const wallet = yield* Wallet;
    const { requestId } = yield* RequestTrace;
    return yield* walletTask(() => work(wallet)).pipe(
      Effect.catch((error) => {
        if (error instanceof WalletDependencyFailure && error.reason === "mismatch") {
          logWalletAnomaly({ requestId, operation, orderId });
          return Effect.succeed(problem("PAYMENT_MISMATCH"));
        }
        logWalletFailure({ requestId, operation, orderId, ...walletErrorFields(error) });
        return Effect.succeed(problem("WALLET_UNAVAILABLE"));
      }),
    );
  });
export function walletRoutes(config: WalletConfig) {
  const live = HttpApiBuilder.group(WalletApi, "wallet", (handlers) =>
    handlers
      .handle("health", () => Effect.succeed({ status: "ok" as const }))
      .handle("ready", () =>
        Effect.gen(function* () {
          const wallet = yield* Wallet;
          return yield* walletTask(async () =>
            (await wallet.ready()) ? { status: "ok" as const } : problem("WALLET_UNAVAILABLE"),
          ).pipe(Effect.catch(() => Effect.succeed(problem("WALLET_UNAVAILABLE"))));
        }),
      )
      .handle("create", ({ payload }) =>
        walletCall("create_invoice", payload.orderId, (wallet) =>
          wallet.create(payload.orderId, payload.amountSat),
        ),
      )
      .handle("lookup", ({ payload }) =>
        walletCall("query_payment", payload.orderId, (wallet) =>
          wallet.find(payload.orderId, payload.amountSat, payload.paymentHash, payload.invoice),
        ),
      )
      .handle("completed", ({ payload }) =>
        walletCall("list_completed", undefined, (wallet) => wallet.completed(payload.since)),
      ),
  );
  return HttpApiBuilder.layer(WalletApi).pipe(
    Layer.provide(live),
    Layer.provide(walletAuth(config.token)),
    Layer.provide(errorBoundary),
  );
}
export function walletWebHandler(config: WalletConfig, service: typeof Wallet.Service) {
  return HttpRouter.toWebHandler(
    walletRoutes(config).pipe(
      Layer.provideMerge(Layer.succeed(Wallet, service)),
      Layer.provide(HttpServer.layerServices),
    ),
    { disableLogger: true },
  );
}
