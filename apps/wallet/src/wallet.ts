import { Context } from "effect";
import type { createSparkWallet } from "./spark.ts";
export class Wallet extends Context.Service<Wallet, ReturnType<typeof createSparkWallet>>()(
  "wallet/Wallet",
) {}
