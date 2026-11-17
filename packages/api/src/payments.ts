import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

export const MerchantId = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{2,31}$/));
export const OrderId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
);
export const IdempotencyKey = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{16,128}$/));
export const Sats = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9_007_199_254_740 }));
export const Millisats = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
export const UsdCents = Schema.Int.check(Schema.isBetween({ minimum: 1000, maximum: 30000 }));
export const Reference = Schema.String.check(Schema.isMaxLength(128));
export const NewOrder = Schema.Struct({
  amountUsdCents: UsdCents,
  reference: Schema.optional(Reference),
});
export const PaymentStatus = Schema.Literals(["creating", "pending", "paid", "expired", "failed"]);
export const PublicMerchant = Schema.Struct({
  merchantId: MerchantId,
  enabled: Schema.Boolean,
  currency: Schema.Literal("USD"),
  minAmountUsdCents: Schema.Literal(1000),
  maxAmountUsdCents: Schema.Literal(30000),
});
export const PublicOrder = Schema.Struct({
  id: OrderId,
  merchantId: MerchantId,
  amountUsdCents: UsdCents,
  amountSat: Sats,
  status: PaymentStatus,
  invoice: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.String),
  serverTime: Schema.String,
});
export const Merchant = Schema.Struct({
  id: MerchantId,
  enabled: Schema.Boolean,
  createdAt: Schema.String,
});
export const AdminOrder = Schema.Struct({
  ...PublicOrder.fields,
  reference: Schema.String,
  rateUsd: Schema.String,
  rateSource: Schema.Literal("coinbase"),
  quotedAt: Schema.String,
  createdAt: Schema.String,
  paidAt: Schema.NullOr(Schema.String),
  paymentHash: Schema.NullOr(Schema.String),
  receivedMsat: Schema.NullOr(Millisats),
  feeMsat: Schema.NullOr(Millisats),
  settlementId: Schema.NullOr(OrderId),
});
export const NewSettlement = Schema.Struct({
  merchantId: MerchantId,
  orderIds: Schema.Array(OrderId).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  amountSat: Sats,
  proof: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000)),
});
export const Settlement = Schema.Struct({
  id: OrderId,
  merchantId: MerchantId,
  amountSat: Sats,
  orderIds: Schema.Array(OrderId),
  proof: Schema.String,
  createdAt: Schema.String,
  createdBy: Schema.String,
});
export const Summary = Schema.Struct({
  merchantId: MerchantId,
  paidSat: Schema.Int,
  settledSat: Schema.Int,
  unsettledSat: Schema.Int,
});
export const paymentErrorStatus = {
  INVALID_INPUT: 400,
  INVALID_BODY: 400,
  INVALID_EVENT: 400,
  BODY_TOO_LARGE: 400,
  INVALID_DATE: 400,
  INVALID_PAGINATION: 400,
  DUPLICATE_ORDER: 400,
  UNAUTHORIZED: 401,
  ADMIN_REQUIRED: 403,
  ORIGIN_REJECTED: 403,
  NOT_FOUND: 404,
  MERCHANT_NOT_FOUND: 404,
  ORDER_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  IDEMPOTENCY_CONFLICT: 409,
  MERCHANT_DISABLED: 409,
  MERCHANT_EXISTS: 409,
  SETTLEMENT_CONFLICT: 409,
  PAYMENT_MISMATCH: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  QUOTE_UNAVAILABLE: 503,
  SYNC_NOT_CONFIGURED: 503,
  GATEWAY_NOT_CONFIGURED: 503,
  PAYMENTS_NOT_CONFIGURED: 503,
  WEBHOOK_NOT_CONFIGURED: 503,
  PAYMENTS_UNAVAILABLE: 503,
  GATEWAY_UNAVAILABLE: 503,
  AMOUNT_OVERFLOW: 503,
} as const;
export type PaymentErrorCode = keyof typeof paymentErrorStatus;
export const PaymentProblem = Schema.Struct({
  code: Schema.Literals(Object.keys(paymentErrorStatus) as PaymentErrorCode[]),
  message: Schema.String,
});
const errors = [400, 401, 403, 404, 405, 409, 429, 500, 503].map((httpApiStatus) =>
  PaymentProblem.annotate({ httpApiStatus }),
);
const paging = { limit: Schema.optional(Schema.String), offset: Schema.optional(Schema.String) };
const merchantParams = { merchantId: MerchantId };
const orderParams = { orderId: OrderId };
const idempotencyHeaders = { "idempotency-key": IdempotencyKey };
export const PaymentsApi = HttpApi.make("PaymentsApi").add(
  HttpApiGroup.make("publicPayments").add(
    HttpApiEndpoint.get("merchant", "/api/public/merchants/:merchantId", {
      params: merchantParams,
      success: PublicMerchant,
      error: errors,
    }),
    HttpApiEndpoint.post("createOrder", "/api/public/merchants/:merchantId/orders", {
      params: merchantParams,
      headers: idempotencyHeaders,
      payload: NewOrder,
      success: PublicOrder,
      error: errors,
    }),
    HttpApiEndpoint.get("order", "/api/public/orders/:orderId", {
      params: orderParams,
      success: PublicOrder,
      error: errors,
    }),
  ),
  HttpApiGroup.make("adminPayments").add(
    HttpApiEndpoint.post("createMerchant", "/api/admin/merchants", {
      payload: Schema.Struct({ id: MerchantId }),
      success: Merchant,
      error: errors,
    }),
    HttpApiEndpoint.get("merchants", "/api/admin/merchants", {
      query: paging,
      success: Schema.Array(Merchant),
      error: errors,
    }),
    HttpApiEndpoint.patch("updateMerchant", "/api/admin/merchants/:merchantId", {
      params: merchantParams,
      payload: Schema.Struct({ enabled: Schema.Boolean }),
      success: Merchant,
      error: errors,
    }),
    HttpApiEndpoint.get("orders", "/api/admin/orders", {
      query: {
        ...paging,
        merchantId: Schema.optional(MerchantId),
        status: Schema.optional(PaymentStatus),
        from: Schema.optional(Schema.String),
        to: Schema.optional(Schema.String),
      },
      success: Schema.Array(AdminOrder),
      error: errors,
    }),
    HttpApiEndpoint.get("order", "/api/admin/orders/:orderId", {
      params: orderParams,
      success: AdminOrder,
      error: errors,
    }),
    HttpApiEndpoint.get("summary", "/api/admin/merchants/:merchantId/summary", {
      params: merchantParams,
      success: Summary,
      error: errors,
    }),
    HttpApiEndpoint.post("settle", "/api/admin/settlements", {
      headers: idempotencyHeaders,
      payload: NewSettlement,
      success: Settlement,
      error: errors,
    }),
    HttpApiEndpoint.get("settlements", "/api/admin/settlements", {
      query: { ...paging, merchantId: Schema.optional(MerchantId) },
      success: Schema.Array(Settlement),
      error: errors,
    }),
  ),
);

export const GatewayRequest = Schema.Struct({ orderId: OrderId, amountSat: Sats });
export const GatewayInvoice = Schema.Struct({
  orderId: OrderId,
  amountSat: Sats,
  paymentHash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  invoice: Schema.String.check(
    Schema.isPattern(/^lnbc[0-9]+[munp]?1[0-9a-z]+$/),
    Schema.isMaxLength(4096),
  ),
  expiresAt: Schema.String,
});
export const GatewayPayment = Schema.Struct({
  ...GatewayInvoice.fields,
  paidAt: Schema.NullOr(Schema.String),
  receivedMsat: Schema.NullOr(Millisats),
  feeMsat: Schema.NullOr(Millisats),
});
export const GatewayLookup = Schema.Struct({
  ...GatewayRequest.fields,
  paymentHash: GatewayInvoice.fields.paymentHash,
});
export const GatewayApi = HttpApi.make("LightningGatewayApi").add(
  HttpApiGroup.make("gateway").add(
    HttpApiEndpoint.get("health", "/health", {
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
    HttpApiEndpoint.post("create", "/v1/invoices", {
      headers: { authorization: Schema.optional(Schema.String) },
      payload: GatewayRequest,
      success: [GatewayPayment, Schema.Null.annotate({ httpApiStatus: 202 })],
      error: errors,
    }),
    HttpApiEndpoint.post("lookup", "/v1/payments/query", {
      headers: { authorization: Schema.optional(Schema.String) },
      payload: GatewayLookup,
      success: [GatewayPayment, Schema.Null.annotate({ httpApiStatus: 202 })],
      error: errors,
    }),
  ),
);
