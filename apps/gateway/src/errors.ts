import { Schema } from "effect";
export class GatewayFailure extends Schema.TaggedError<GatewayFailure>()("GatewayFailure", {
  code: Schema.Literals([
    "IDEMPOTENCY_CONFLICT",
    "UNAUTHORIZED",
    "WEBHOOK_NOT_CONFIGURED",
    "INVALID_EVENT",
  ]),
}) {}
export class GatewayDependencyFailure extends Schema.TaggedError<GatewayDependencyFailure>()(
  "GatewayDependencyFailure",
  {
    dependency: Schema.Literals(["phoenix", "worker"]),
    reason: Schema.Literals(["timeout", "network", "http", "invalid_response", "mismatch"]),
    upstreamStatus: Schema.optional(Schema.Int),
  },
) {}
export function gatewayErrorFields(error: unknown) {
  if (error instanceof GatewayFailure) return { code: error.code };
  if (error instanceof GatewayDependencyFailure)
    return {
      code: "UPSTREAM_FAILURE",
      dependency: error.dependency,
      reason: error.reason,
      upstreamStatus: error.upstreamStatus,
    };
  return { code: "INTERNAL_ERROR" };
}
export function logGatewayFailure(entry: {
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
  console.error(JSON.stringify({ event: "gateway_failure", ...entry }));
}
