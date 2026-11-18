export type WalletConfig = {
  token: string;
  apiKey: string;
  mnemonic: string;
  databaseUrl: string;
  identityPubkey: string;
  host: string;
  port: number;
};
export function parseConfig(env: NodeJS.ProcessEnv): WalletConfig {
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
  const port = Number(env.WALLET_PORT ?? 9741);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid WALLET_PORT");
  return {
    token,
    databaseUrl,
    identityPubkey,
    apiKey: required("BREEZ_API_KEY"),
    mnemonic: required("BREEZ_MNEMONIC"),
    host: env.WALLET_HOST ?? "127.0.0.1",
    port,
  };
}
