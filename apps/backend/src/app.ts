import { Api } from "@btc-lightning-pay/api";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { Phoenix } from "./phoenix";

const HealthLive = HttpApiBuilder.group(Api, "health", (handlers) =>
  handlers.handle("get", () => Effect.succeed({ status: "ok" as const })),
);

const InvoicesLive = HttpApiBuilder.group(Api, "invoices", (handlers) =>
  handlers.handle("create", ({ payload }) =>
    Effect.gen(function* () {
      const phoenix = yield* Phoenix;
      return yield* phoenix.create(payload);
    }),
  ),
);

export const { handler, dispose } = HttpRouter.toWebHandler(
  HttpApiBuilder.layer(Api).pipe(
    Layer.provide(HealthLive),
    Layer.provide(InvoicesLive),
    Layer.provide(HttpServer.layerServices),
  ),
);
