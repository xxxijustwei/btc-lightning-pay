import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer, Schedule } from "effect";
import { HttpRouter, HttpIncomingMessage } from "effect/http";
import { ByteSize } from "effect";
import { parseConfig } from "./config.ts";
import { createGatewayService, Gateway } from "./gateway.ts";
import { createJobStore } from "./store.ts";
import { createPhoenixClient, createWorkerClient } from "./phoenix.ts";
import { gatewayRoutes } from "./app.ts";

const config = parseConfig(process.env);
process.umask(0o077);
const ServiceLive = Layer.effect(
  Gateway,
  Effect.gen(function* () {
    const db = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const file = resolve(config.database);
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        return new DatabaseSync(file);
      }),
      (db) => Effect.sync(() => db.close()),
    );
    const service = createGatewayService(
      createJobStore(db),
      createPhoenixClient(config),
      createWorkerClient(config),
    );
    // Stop accepting background jobs, then drain the current job before closing SQLite.
    const poll = Effect.callback<void>((resume) => {
      const stop = new AbortController();
      const running = service.tick(stop.signal);
      running.then(
        () => resume(Effect.void),
        () => resume(Effect.logError("Payment polling failed")),
      );
      return Effect.promise(async () => {
        stop.abort();
        await running.catch(() => {});
      });
    });
    yield* poll.pipe(Effect.repeat(Schedule.spaced("10 seconds")), Effect.forkScoped);
    return service;
  }),
);
const Server = gatewayRoutes(config).pipe(
  HttpRouter.serve,
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
