import { Context } from "effect";
import type { createPhoenixClient } from "./phoenix.ts";
export class Gateway extends Context.Service<Gateway, ReturnType<typeof createPhoenixClient>>()(
  "gateway/Gateway",
) {}
