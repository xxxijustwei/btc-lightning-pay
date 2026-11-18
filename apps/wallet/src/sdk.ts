import {
  defaultConfig,
  defaultPostgresStorageConfig,
  postgresStorage,
  SdkBuilder,
} from "@breeztech/breez-sdk-spark/nodejs";
import { createSparkWallet } from "./spark.ts";
import type { WalletConfig } from "./config.ts";
export async function openWallet(config: WalletConfig) {
  const settings = defaultConfig("mainnet");
  settings.apiKey = config.apiKey;
  settings.realTimeSyncServerUrl = undefined;
  settings.preferSparkOverLightning = false;
  settings.syncIntervalSecs = 60;
  const sdk = await SdkBuilder.new(settings, { type: "mnemonic", mnemonic: config.mnemonic })
    .withStorageBackend(postgresStorage(defaultPostgresStorageConfig(config.databaseUrl)))
    .build();
  try {
    const info = await sdk.getInfo({ ensureSynced: true });
    if (info.identityPubkey !== config.identityPubkey || info.lastSyncError)
      throw new Error("Wallet not ready");
    return { wallet: createSparkWallet(sdk), close: () => sdk.disconnect() };
  } catch {
    await sdk.disconnect();
    throw new Error("Wallet initialization failed");
  }
}
