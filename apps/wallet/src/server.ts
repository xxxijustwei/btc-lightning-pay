import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpIncomingMessage } from "effect/http";
import { ByteSize } from "effect";
import { parseConfig } from "./config.ts";
import { Wallet } from "./wallet.ts";
import { openWallet } from "./sdk.ts";
import { walletRoutes } from "./app.ts";

const config = parseConfig(process.env);
process.umask(0o077);
const ServiceLive = Layer.effect(
  Wallet,
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () => openWallet(config),
      catch: () => new Error("Wallet initialization failed"),
    }),
    (resource) => Effect.promise(() => resource.close()),
  ).pipe(Effect.map((resource) => resource.wallet)),
);
const Server = walletRoutes(config).pipe(
  (routes) => HttpRouter.serve(routes, { disableLogger: true }),
  Layer.provide(ServiceLive),
  Layer.provide(Layer.succeed(HttpIncomingMessage.MaxBodySize, ByteSize.kibibytes(8))),
  Layer.provide(
    NodeHttpServer.layer(() => createServer({ requestTimeout: 15_000 }), {
      host: config.host,
      port: config.port,
    }),
  ),
);
NodeRuntime.runMain(Layer.launch(Server));
