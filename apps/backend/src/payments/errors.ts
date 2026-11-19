import { paymentErrorStatus, type PaymentErrorCode } from "@btc-lightning-pay/api";
import { Schema } from "effect";

/** A failure with a public code; the contract's status table is the single list of codes. */
export class PaymentFailure extends Schema.TaggedError<PaymentFailure>()("PaymentFailure", {
  code: Schema.Literals(Object.keys(paymentErrorStatus) as PaymentErrorCode[]),
}) {}
export class StorageFailure extends Schema.TaggedError<StorageFailure>()("StorageFailure", {
  operation: Schema.String,
}) {}
export class UpstreamFailure extends Schema.TaggedError<UpstreamFailure>()("UpstreamFailure", {
  dependency: Schema.Literals(["coinbase", "wallet"]),
  reason: Schema.Literals(["timeout", "network", "http", "invalid_response", "mismatch"]),
  upstreamStatus: Schema.optional(Schema.Int),
}) {}
export type PaymentError = PaymentFailure | StorageFailure | UpstreamFailure;
