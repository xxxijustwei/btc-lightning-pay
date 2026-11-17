import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";
import { HttpRouter, HttpIncomingMessage } from "effect/http";
import { ByteSize } from "effect";
import { parseConfig } from "./config.ts";
import { Gateway } from "./gateway.ts";
import { createPhoenixClient } from "./phoenix.ts";
import { gatewayRoutes } from "./app.ts";

const config = parseConfig(process.env);
process.umask(0o077);
const ServiceLive = Layer.succeed(Gateway, createPhoenixClient(config));
const Server = gatewayRoutes(config).pipe(
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
