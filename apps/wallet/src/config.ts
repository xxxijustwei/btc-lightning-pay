import { readFileSync } from "node:fs";
export type WalletConfig = {
  token: string;
  apiKey: string;
  mnemonic: string;
  databaseUrl: string;
  identityPubkey: string;
  host: string;
  port: number;
};
/** A secret from `NAME`, or from the file named by `NAME_FILE` (a mounted Docker secret). */
export function readSecret(
  env: NodeJS.ProcessEnv,
  name: string,
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
) {
  const file = env[`${name}_FILE`]?.trim();
  if (file && env[name]) throw new Error(`Set only one of ${name} and ${name}_FILE`);
  if (!file) return env[name]?.trim();
  try {
    return read(file).trim();
  } catch {
    throw new Error(`Unreadable ${name}_FILE`);
  }
}
export function parseConfig(env: NodeJS.ProcessEnv, read?: (path: string) => string): WalletConfig {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  const token = required("WALLET_TOKEN");
  if (token.length < 32) throw new Error("Invalid WALLET_TOKEN");
  const databaseUrl = required("BREEZ_DATABASE_URL");
  try {
    if (!["postgres:", "postgresql:"].includes(new URL(databaseUrl).protocol)) throw 0;
  } catch {
    throw new Error("Invalid BREEZ_DATABASE_URL");
  }
  const identityPubkey = required("BREEZ_IDENTITY_PUBKEY");
  if (!/^(02|03)[0-9a-f]{64}$/.test(identityPubkey))
    throw new Error("Invalid BREEZ_IDENTITY_PUBKEY");
  const mnemonic = readSecret(env, "BREEZ_MNEMONIC", read);
  if (!mnemonic) throw new Error("Missing BREEZ_MNEMONIC or BREEZ_MNEMONIC_FILE");
  const port = Number(env.WALLET_PORT ?? 9741);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid WALLET_PORT");
  return {
    token,
    databaseUrl,
    identityPubkey,
    apiKey: required("BREEZ_API_KEY"),
    mnemonic,
    host: env.WALLET_HOST ?? "127.0.0.1",
    port,
  };
}
