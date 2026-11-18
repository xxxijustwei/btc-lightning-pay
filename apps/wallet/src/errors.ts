import { Schema } from "effect";
export class WalletFailure extends Schema.TaggedError<WalletFailure>()("WalletFailure", {
  code: Schema.Literals([
    "IDEMPOTENCY_CONFLICT",
    "UNAUTHORIZED",
    "WEBHOOK_NOT_CONFIGURED",
    "INVALID_EVENT",
  ]),
}) {}
export class WalletDependencyFailure extends Schema.TaggedError<WalletDependencyFailure>()(
  "WalletDependencyFailure",
  {
    dependency: Schema.Literals(["breez"]),
    reason: Schema.Literals(["timeout", "network", "http", "invalid_response", "mismatch"]),
    upstreamStatus: Schema.optional(Schema.Int),
  },
) {}
export function walletErrorFields(error: unknown) {
  if (error instanceof WalletFailure) return { code: error.code };
  if (error instanceof WalletDependencyFailure)
    return {
      code: "UPSTREAM_FAILURE",
      dependency: error.dependency,
      reason: error.reason,
      upstreamStatus: error.upstreamStatus,
    };
  return { code: "INTERNAL_ERROR" };
}
export function logWalletFailure(entry: {
  operation: string;
  orderId?: string;
  requestId?: string;
  code: string;
  durationMs?: number;
  attempts?: number;
  nextRetryAt?: number;
  dependency?: string;
  reason?: string;
  upstreamStatus?: number;
}) {
  console.error(JSON.stringify({ event: "wallet_failure", ...entry }));
}
