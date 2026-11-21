import { Context } from "effect";
import type { createPayouts } from "./payouts.ts";
import type { createSparkWallet } from "./spark.ts";
export type WalletService = ReturnType<typeof createSparkWallet> & {
  payouts: ReturnType<typeof createPayouts>;
};
export class Wallet extends Context.Service<Wallet, WalletService>()("wallet/Wallet") {}
