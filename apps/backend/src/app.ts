import { Api } from "@btc-lightning-pay/api";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

const HealthLive = HttpApiBuilder.group(Api, "health", (handlers) =>
  handlers.handle("get", () => Effect.succeed({ status: "ok" as const })),
);

export const { handler, dispose } = HttpRouter.toWebHandler(
  HttpApiBuilder.layer(Api).pipe(
    Layer.provide(HealthLive),
    Layer.provide(HttpServer.layerServices),
  ),
);
