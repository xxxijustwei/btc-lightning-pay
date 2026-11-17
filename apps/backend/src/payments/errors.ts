import { Schema } from "effect";

export class PaymentFailure extends Schema.TaggedError<PaymentFailure>()("PaymentFailure", {
  code: Schema.Literals([
    "ORDER_NOT_FOUND",
    "MERCHANT_NOT_FOUND",
    "IDEMPOTENCY_CONFLICT",
    "MERCHANT_DISABLED",
    "RATE_LIMITED",
    "QUOTE_UNAVAILABLE",
    "PAYMENT_MISMATCH",
    "MERCHANT_EXISTS",
    "INVALID_DATE",
    "AMOUNT_OVERFLOW",
    "DUPLICATE_ORDER",
    "SETTLEMENT_CONFLICT",
    "ADMIN_REQUIRED",
    "INVALID_PAGINATION",
    "BODY_TOO_LARGE",
    "SYNC_NOT_CONFIGURED",
    "UNAUTHORIZED",
    "ORIGIN_REJECTED",
    "GATEWAY_NOT_CONFIGURED",
    "PAYMENTS_NOT_CONFIGURED",
    "INVALID_INPUT",
  ]),
}) {}
export class StorageFailure extends Schema.TaggedError<StorageFailure>()("StorageFailure", {
  operation: Schema.String,
}) {}
export class UpstreamFailure extends Schema.TaggedError<UpstreamFailure>()("UpstreamFailure", {
  dependency: Schema.Literals(["coinbase", "gateway"]),
  reason: Schema.Literals(["timeout", "network", "http", "invalid_response", "mismatch"]),
  upstreamStatus: Schema.optional(Schema.Int),
}) {}
export type PaymentError = PaymentFailure | StorageFailure | UpstreamFailure;
