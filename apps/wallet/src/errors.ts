import { Schema } from "effect";
export class WalletDependencyFailure extends Schema.TaggedError<WalletDependencyFailure>()(
  "WalletDependencyFailure",
  {
    dependency: Schema.Literals(["breez"]),
    reason: Schema.Literals(["timeout", "network", "http", "invalid_response", "mismatch"]),
    upstreamStatus: Schema.optional(Schema.Int),
  },
) {}
export function walletErrorFields(error: unknown) {
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
/** A receipt or invoice that contradicts its order: never an outage, never silently dropped. */
export function logWalletAnomaly(entry: {
  operation: string;
  orderId?: string;
  requestId?: string;
}) {
  console.error(JSON.stringify({ event: "payment_anomaly", ...entry }));
}
/** A request without the shared token: a misconfiguration or a probe, never a wallet outage. */
export function logWalletUnauthorized(entry: { path: string; requestId?: string }) {
  console.error(JSON.stringify({ event: "wallet_unauthorized", ...entry }));
}
