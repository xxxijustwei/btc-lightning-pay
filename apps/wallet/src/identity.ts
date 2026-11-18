import { defaultExternalSigners } from "@breeztech/breez-sdk-spark/nodejs";
const mnemonic = process.env.BREEZ_MNEMONIC;
if (!mnemonic) throw new Error("Missing BREEZ_MNEMONIC");
try {
  const signers = defaultExternalSigners(mnemonic, undefined, "mainnet");
  const key = await signers.sparkSigner.getIdentityPublicKey();
  console.info(`BREEZ_IDENTITY_PUBKEY=${Buffer.from(key.bytes).toString("hex")}`);
} catch {
  throw new Error("Unable to derive wallet identity; check mnemonic");
}
