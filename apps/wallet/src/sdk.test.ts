import { expect, test } from "vite-plus/test";
import {
  defaultConfig,
  defaultServerConfig,
  SdkBuilder,
  defaultExternalSigners,
  defaultPostgresStorageConfig,
  postgresStorage,
} from "@breeztech/breez-sdk-spark/nodejs";
test("published Node WASM SDK loads and derives a stable wallet identity offline", async () => {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const identity = async () =>
    Buffer.from(
      (
        await defaultExternalSigners(
          mnemonic,
          undefined,
          "mainnet",
        ).sparkSigner.getIdentityPublicKey()
      ).bytes,
    ).toString("hex");
  expect(await identity()).toMatch(/^(02|03)[0-9a-f]{64}$/);
  expect(await identity()).toBe(await identity());
  expect(defaultConfig("mainnet").backgroundTasksEnabled).toBe(true);
  const storage = postgresStorage(defaultPostgresStorageConfig("postgres://localhost/test"));
  expect(storage).toBeDefined();
  storage.free();
});

const testUrl = process.env.BREEZ_TEST_DATABASE_URL;
test.skipIf(!testUrl)(
  "SDK PostgreSQL storage reopens the same wallet without SQLite",
  async () => {
    const url = new URL(testUrl!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/wallet_test")
      throw new Error("BREEZ_TEST_DATABASE_URL must target a dedicated local wallet_test database");
    let identity: string | undefined;
    for (let i = 0; i < 2; i++) {
      const sdk = await SdkBuilder.new(defaultServerConfig("regtest"), {
        type: "mnemonic",
        mnemonic:
          "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      })
        .withStorageBackend(postgresStorage(defaultPostgresStorageConfig(testUrl!)))
        .build();
      try {
        const info = await sdk.getInfo({});
        expect(info.balanceSats).toBe(0);
        expect(info.identityPubkey).toMatch(/^(02|03)[0-9a-f]{64}$/);
        if (identity) expect(info.identityPubkey).toBe(identity);
        identity = info.identityPubkey;
        expect((await sdk.listPayments({})).payments).toEqual([]);
      } finally {
        await sdk.disconnect();
      }
    }
  },
  30000,
);
