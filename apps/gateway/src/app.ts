import { createHmac, timingSafeEqual } from "node:crypto";
import { GatewayApi, PhoenixEvent } from "@btc-lightning-pay/api/payments";
import { Effect, Layer, Schema } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http";
import { Gateway, GatewayFailure } from "./gateway.ts";
import type { GatewayConfig } from "./config.ts";

function equal(actual: string, expected: string) {
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
const failure = (error: unknown) => {
  const known = error instanceof GatewayFailure;
  if (!known) console.error(JSON.stringify({ event: "gateway_operation_pending" }));
  return HttpServerResponse.jsonUnsafe(
    {
      code: known ? error.code : "GATEWAY_UNAVAILABLE",
      message: known ? error.code : "Gateway operation pending",
    },
    { status: known ? error.status : 503 },
  );
};
export function gatewayRoutes(config: GatewayConfig) {
  const live = HttpApiBuilder.group(GatewayApi, "gateway", (handlers) =>
    handlers
      .handle("health", () => Effect.succeed({ status: "ok" as const }))
      .handle("create", ({ payload, headers }) =>
        Effect.gen(function* () {
          const gateway = yield* Gateway;
          return yield* Effect.tryPromise({
            try: async () => {
              if (!equal(headers.authorization ?? "", `Bearer ${config.token}`))
                throw new GatewayFailure(401, "UNAUTHORIZED");
              const result = await gateway.create(payload);
              return result ?? HttpServerResponse.jsonUnsafe(null, { status: 202 });
            },
            catch: failure,
          }).pipe(Effect.catch((response) => Effect.succeed(response)));
        }),
      )
      .handleRaw("webhook", ({ request }) =>
        Effect.gen(function* () {
          const gateway = yield* Gateway;
          const text = yield* request.text;
          return yield* Effect.tryPromise({
            try: async () => {
              if (!config.webhookSecret) throw new GatewayFailure(503, "WEBHOOK_NOT_CONFIGURED");
              const expected = createHmac("sha256", config.webhookSecret)
                .update(text)
                .digest("hex");
              if (!equal(request.headers["x-phoenix-signature"] ?? "", expected))
                throw new GatewayFailure(401, "UNAUTHORIZED");
              let event;
              try {
                event = Schema.decodeUnknownSync(PhoenixEvent)(JSON.parse(text));
              } catch {
                throw new GatewayFailure(400, "INVALID_EVENT");
              }
              if (event.externalId) await gateway.received(event.externalId);
              return HttpServerResponse.jsonUnsafe({ ok: true });
            },
            catch: failure,
          }).pipe(Effect.catch((response) => Effect.succeed(response)));
        }).pipe(
          Effect.catch(() =>
            Effect.succeed(
              HttpServerResponse.jsonUnsafe({ code: "INVALID_BODY" }, { status: 400 }),
            ),
          ),
        ),
      ),
  );
  return HttpApiBuilder.layer(GatewayApi).pipe(Layer.provide(live));
}
export function gatewayWebHandler(config: GatewayConfig, service: typeof Gateway.Service) {
  return HttpRouter.toWebHandler(
    gatewayRoutes(config).pipe(
      Layer.provideMerge(Layer.succeed(Gateway, service)),
      Layer.provide(HttpServer.layerServices),
    ),
  );
}
