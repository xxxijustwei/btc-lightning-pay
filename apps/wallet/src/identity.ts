import { defaultExternalSigners } from "@breeztech/breez-sdk-spark/nodejs";
import { readSecret } from "./config.ts";
const mnemonic = readSecret(process.env, "BREEZ_MNEMONIC");
if (!mnemonic) throw new Error("Missing BREEZ_MNEMONIC or BREEZ_MNEMONIC_FILE");
try {
  const signers = defaultExternalSigners(mnemonic, undefined, "mainnet");
  const key = await signers.sparkSigner.getIdentityPublicKey();
  console.info(`BREEZ_IDENTITY_PUBKEY=${Buffer.from(key.bytes).toString("hex")}`);
} catch {
  throw new Error("Unable to derive wallet identity; check mnemonic");
}
