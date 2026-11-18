import { timingSafeEqual } from "node:crypto";
import { WalletApi } from "@btc-lightning-pay/api/payments";
import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http";
import { Wallet } from "./wallet.ts";
import { WalletFailure, walletErrorFields, logWalletFailure } from "./errors.ts";
import { walletTask } from "./runtime.ts";
import type { WalletConfig } from "./config.ts";
import { errorBoundary, problem, RequestTrace } from "./http.ts";

function equal(actual: string, expected: string) {
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
const failure = (error: unknown, requestId: string, operation: string, orderId?: string) => {
  logWalletFailure({ requestId, operation, orderId, ...walletErrorFields(error) });
  return problem(error instanceof WalletFailure ? error.code : "WALLET_UNAVAILABLE");
};
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
      .handle("create", ({ payload, headers }) =>
        Effect.gen(function* () {
          const wallet = yield* Wallet;
          const { requestId } = yield* RequestTrace;
          return yield* walletTask(async () => {
            if (!equal(headers.authorization ?? "", `Bearer ${config.token}`))
              throw new WalletFailure({ code: "UNAUTHORIZED" });
            const result = await wallet.create(payload.orderId, payload.amountSat);
            return result ?? HttpServerResponse.jsonUnsafe(null, { status: 202 });
          }).pipe(
            Effect.catch((error) =>
              Effect.succeed(failure(error, requestId, "create_invoice", payload.orderId)),
            ),
          );
        }),
      )
      .handle("lookup", ({ payload, headers }) =>
        Effect.gen(function* () {
          const wallet = yield* Wallet;
          const { requestId } = yield* RequestTrace;
          return yield* walletTask(async () => {
            if (!equal(headers.authorization ?? "", `Bearer ${config.token}`))
              throw new WalletFailure({ code: "UNAUTHORIZED" });
            return (
              (await wallet.find(
                payload.orderId,
                payload.amountSat,
                payload.paymentHash,
                payload.invoice,
              )) ?? HttpServerResponse.jsonUnsafe(null, { status: 202 })
            );
          }).pipe(
            Effect.catch((error) =>
              Effect.succeed(failure(error, requestId, "query_payment", payload.orderId)),
            ),
          );
        }),
      ),
  );
  return HttpApiBuilder.layer(WalletApi).pipe(Layer.provide(live), Layer.provide(errorBoundary));
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
