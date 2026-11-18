import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test, expect } from "vite-plus/test";

const run = promisify(execFile);
test("Bun loads the real SDK and serves authenticated wallet HTTP with scoped cleanup", async () => {
  const { stdout } = await run(
    "bun",
    [
      "--no-env-file",
      "--eval",
      `
    import assert from "node:assert/strict";
    import { createServer } from "node:http";
    import { Effect, Layer } from "effect";
    import { NodeHttpServer } from "@effect/platform-node";
    import { HttpRouter } from "effect/http";
    import { defaultExternalSigners, defaultPostgresStorageConfig, postgresStorage } from "@breeztech/breez-sdk-spark/nodejs";
    import { walletRoutes } from "./src/app.ts";
    import { Wallet } from "./src/wallet.ts";
    const signers = defaultExternalSigners("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", undefined, "mainnet");
    assert.equal((await signers.sparkSigner.getIdentityPublicKey()).bytes.length, 33);
    const storage = postgresStorage(defaultPostgresStorageConfig("postgres://localhost/unused_offline_probe"));
    storage.free();
    const server = createServer();
    const token = "test-token-".repeat(4);
    let released = false;
    const service = Layer.effect(Wallet, Effect.acquireRelease(
      Effect.succeed({ ready: async () => true, create: async () => null, find: async () => null }),
      () => Effect.sync(() => { released = true; }),
    ));
    const app = walletRoutes({ token }).pipe(
      routes => HttpRouter.serve(routes, { disableLogger: true }),
      Layer.provide(service),
      Layer.provide(NodeHttpServer.layer(() => server, { host: "127.0.0.1", port: 0 })),
    );
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      yield* Layer.build(app);
      yield* Effect.promise(async () => {
        const origin = "http://127.0.0.1:" + server.address().port;
        assert.equal((await fetch(origin + "/ready")).status, 200);
        const request = (authorization) => fetch(origin + "/v1/invoices", {
          method: "POST", headers: { "content-type": "application/json", authorization },
          body: JSON.stringify({ orderId: "12345678-1234-4234-8234-123456789abc", amountSat: 10000 }),
        });
        assert.equal((await request("Bearer invalid")).status, 401);
        assert.equal((await request("Bearer " + token)).status, 202);
      });
    })));
    assert.equal(released, true);
    assert.equal(server.listening, false);
    console.log("bun-wallet-runtime-ok");
  `,
    ],
    {
      cwd: new URL("..", import.meta.url),
      env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR },
      timeout: 15000,
    },
  );
  expect(stdout).toContain("bun-wallet-runtime-ok");
}, 20000);

const databaseUrl = process.env.BREEZ_TEST_DATABASE_URL;
test.skipIf(!databaseUrl)(
  "Bun SDK reconnects to isolated PostgreSQL storage",
  async () => {
    const target = new URL(databaseUrl!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.pathname !== "/wallet_test")
      throw new Error("BREEZ_TEST_DATABASE_URL must target a dedicated local wallet_test database");
    const { stdout } = await run(
      "bun",
      [
        "--no-env-file",
        "--eval",
        `
    import assert from "node:assert/strict";
    import { SdkBuilder, defaultServerConfig, postgresStorage, defaultPostgresStorageConfig } from "@breeztech/breez-sdk-spark/nodejs";
    let identity;
    for (let i = 0; i < 2; i++) {
      const sdk = await SdkBuilder.new(defaultServerConfig("regtest"), {
        type: "mnemonic", mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      }).withStorageBackend(postgresStorage(defaultPostgresStorageConfig(process.env.BREEZ_TEST_DATABASE_URL))).build();
      try {
        const info = await sdk.getInfo({});
        assert.equal(info.balanceSats, 0);
        if (identity) assert.equal(info.identityPubkey, identity);
        identity = info.identityPubkey;
        assert.deepEqual((await sdk.listPayments({})).payments, []);
      } finally { await sdk.disconnect(); }
    }
    console.log("bun-postgres-ok");
  `,
      ],
      {
        cwd: new URL("..", import.meta.url),
        env: {
          PATH: process.env.PATH,
          TMPDIR: process.env.TMPDIR,
          BREEZ_TEST_DATABASE_URL: databaseUrl,
        },
        timeout: 30000,
      },
    );
    expect(stdout).toContain("bun-postgres-ok");
  },
  35000,
);
