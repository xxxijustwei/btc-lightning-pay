import {
  defaultConfig,
  defaultPostgresStorageConfig,
  postgresStorage,
  SdkBuilder,
} from "@breeztech/breez-sdk-spark/nodejs";
import { createSparkWallet } from "./spark.ts";
import type { WalletConfig } from "./config.ts";

type InitStage = "build" | "sync" | "identity";

/** The failure's text with connection strings and configured secrets removed. */
export function redactInitError(error: unknown, config: WalletConfig) {
  const name = error instanceof Error ? error.name : typeof error;
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [config.mnemonic, config.apiKey, config.token, config.databaseUrl])
    if (secret) message = message.split(secret).join("[redacted]");
  message = message
    .replace(/postgres(ql)?:\/\/\S+/gi, "[redacted-url]")
    .replace(/password=\S+/gi, "password=[redacted]");
  return { name, message: message.slice(0, 500) };
}

function logInitFailure(stage: InitStage, error: unknown, config: WalletConfig) {
  console.error(
    JSON.stringify({ event: "wallet_init_failure", stage, ...redactInitError(error, config) }),
  );
}

export async function openWallet(config: WalletConfig) {
  const settings = defaultConfig("mainnet");
  settings.apiKey = config.apiKey;
  settings.realTimeSyncServerUrl = undefined;
  settings.preferSparkOverLightning = false;
  settings.syncIntervalSecs = 60;
  let sdk;
  try {
    sdk = await SdkBuilder.new(settings, { type: "mnemonic", mnemonic: config.mnemonic })
      .withStorageBackend(postgresStorage(defaultPostgresStorageConfig(config.databaseUrl)))
      .build();
  } catch (error) {
    logInitFailure("build", error, config);
    throw new Error("Wallet initialization failed");
  }
  let stage: InitStage = "sync";
  try {
    const info = await sdk.getInfo({ ensureSynced: true });
    if (info.lastSyncError) throw new Error(`Sync error: ${info.lastSyncError}`);
    stage = "identity";
    // Public keys only: shows whether the mnemonic and BREEZ_IDENTITY_PUBKEY belong together.
    if (info.identityPubkey !== config.identityPubkey)
      throw new Error(
        `Identity ${info.identityPubkey} does not match BREEZ_IDENTITY_PUBKEY ${config.identityPubkey}`,
      );
    return { wallet: createSparkWallet(sdk), close: () => sdk.disconnect() };
  } catch (error) {
    logInitFailure(stage, error, config);
    await sdk.disconnect();
    throw new Error("Wallet initialization failed");
  }
}
