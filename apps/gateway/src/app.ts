import { timingSafeEqual } from "node:crypto";
import { GatewayApi } from "@btc-lightning-pay/api/payments";
import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http";
import { Gateway } from "./gateway.ts";
import { GatewayFailure, gatewayErrorFields, logGatewayFailure } from "./errors.ts";
import { gatewayTask } from "./runtime.ts";
import type { GatewayConfig } from "./config.ts";
import { errorBoundary, problem, RequestTrace } from "./http.ts";

function equal(actual: string, expected: string) {
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
const failure = (error: unknown, requestId: string, operation: string, orderId?: string) => {
  logGatewayFailure({ requestId, operation, orderId, ...gatewayErrorFields(error) });
  return problem(error instanceof GatewayFailure ? error.code : "GATEWAY_UNAVAILABLE");
};
export function gatewayRoutes(config: GatewayConfig) {
  const live = HttpApiBuilder.group(GatewayApi, "gateway", (handlers) =>
    handlers
      .handle("health", () => Effect.succeed({ status: "ok" as const }))
      .handle("create", ({ payload, headers }) =>
        Effect.gen(function* () {
          const gateway = yield* Gateway;
          const { requestId } = yield* RequestTrace;
          return yield* gatewayTask(async () => {
            if (!equal(headers.authorization ?? "", `Bearer ${config.token}`))
              throw new GatewayFailure({ code: "UNAUTHORIZED" });
            const result = await gateway.create(payload.orderId, payload.amountSat);
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
          const gateway = yield* Gateway;
          const { requestId } = yield* RequestTrace;
          return yield* gatewayTask(async () => {
            if (!equal(headers.authorization ?? "", `Bearer ${config.token}`))
              throw new GatewayFailure({ code: "UNAUTHORIZED" });
            return (
              (await gateway.find(payload.orderId, payload.amountSat, payload.paymentHash)) ??
              HttpServerResponse.jsonUnsafe(null, { status: 202 })
            );
          }).pipe(
            Effect.catch((error) =>
              Effect.succeed(failure(error, requestId, "query_payment", payload.orderId)),
            ),
          );
        }),
      ),
  );
  return HttpApiBuilder.layer(GatewayApi).pipe(Layer.provide(live), Layer.provide(errorBoundary));
}
export function gatewayWebHandler(config: GatewayConfig, service: typeof Gateway.Service) {
  return HttpRouter.toWebHandler(
    gatewayRoutes(config).pipe(
      Layer.provideMerge(Layer.succeed(Gateway, service)),
      Layer.provide(HttpServer.layerServices),
    ),
    { disableLogger: true },
  );
}
