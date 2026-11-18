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

  settlementId: Schema.NullOr(OrderId),
  settlementStatus: Schema.NullOr(Schema.Literals(["pending", "settled"])),
});
export const SettlementStatus = Schema.Literals(["pending", "settled", "cancelled"]);
export const SettlementAmount = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 2100000000000000 }),
);
export const NewSettlement = Schema.StructWithRest(Schema.Struct({ merchantId: MerchantId }), [
  Schema.Record(Schema.String, Schema.Unknown),
]).check(Schema.makeFilter((value) => Object.keys(value).every((key) => key === "merchantId")));
export const ConfirmSettlement = Schema.StructWithRest(
  Schema.Struct({ proof: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1000)) }),
  [Schema.Record(Schema.String, Schema.Unknown)],
).check(Schema.makeFilter((value) => Object.keys(value).every((key) => key === "proof")));
export const CancelSettlement = Schema.StructWithRest(
  Schema.Struct({ reason: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)) }),
  [Schema.Record(Schema.String, Schema.Unknown)],
).check(Schema.makeFilter((value) => Object.keys(value).every((key) => key === "reason")));
export const Settlement = Schema.Struct({
  id: OrderId,
  merchantId: MerchantId,
  status: SettlementStatus,
  amountSat: SettlementAmount,
  orderCount: Schema.Int,
  cutoffAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  createdBy: Schema.String,
  proof: Schema.NullOr(Schema.String),
  confirmedAt: Schema.NullOr(Schema.String),
  confirmedBy: Schema.NullOr(Schema.String),
  cancelReason: Schema.NullOr(Schema.String),
  cancelledAt: Schema.NullOr(Schema.String),
  cancelledBy: Schema.NullOr(Schema.String),
});
export const SettlementPage = Schema.Struct({
  items: Schema.Array(Settlement),
  total: Schema.Int,
  limit: Schema.Int,
  offset: Schema.Int,
});
export const SettlementOrderPage = Schema.Struct({
  items: Schema.Array(Schema.Struct({ orderId: OrderId, merchantId: MerchantId, amountSat: Sats })),
  total: Schema.Int,
  limit: Schema.Int,
  offset: Schema.Int,
});
export const Summary = Schema.Struct({
  merchantId: MerchantId,
  paidSat: Schema.Int,
  settledSat: Schema.Int,
  unsettledSat: Schema.Int,
  pendingSettlementSat: Schema.Int,
  availableSettlementSat: Schema.Int,
  unconfirmedOrderCount: Schema.Int,
});
export const paymentErrorStatus = {
  INVALID_INPUT: 400,
  NO_ELIGIBLE_ORDERS: 409,
  SETTLEMENT_NOT_FOUND: 404,
  SETTLEMENT_STATE_CONFLICT: 409,
  SETTLEMENT_PROOF_CONFLICT: 409,
  SETTLEMENT_REASON_CONFLICT: 409,

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
  WALLET_NOT_CONFIGURED: 503,
  PAYMENTS_NOT_CONFIGURED: 503,
  WEBHOOK_NOT_CONFIGURED: 503,
  PAYMENTS_UNAVAILABLE: 503,
  WALLET_UNAVAILABLE: 503,
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
      success: [Settlement, Settlement.annotate({ httpApiStatus: 201 })],
      error: errors,
    }),
    HttpApiEndpoint.get("settlement", "/api/admin/settlements/:orderId", {
      params: orderParams,
      success: Settlement,
      error: errors,
    }),
    HttpApiEndpoint.get("settlementOrders", "/api/admin/settlements/:orderId/orders", {
      params: orderParams,
      query: paging,
      success: SettlementOrderPage,
      error: errors,
    }),
    HttpApiEndpoint.post("confirmSettlement", "/api/admin/settlements/:orderId/confirm", {
      params: orderParams,
      payload: ConfirmSettlement,
      success: Settlement,
      error: errors,
    }),
    HttpApiEndpoint.post("cancelSettlement", "/api/admin/settlements/:orderId/cancel", {
      params: orderParams,
      payload: CancelSettlement,
      success: Settlement,
      error: errors,
    }),
    HttpApiEndpoint.get("settlements", "/api/admin/settlements", {
      query: {
        ...paging,
        merchantId: Schema.optional(MerchantId),
        status: Schema.optional(SettlementStatus),
        from: Schema.optional(Schema.String),
        to: Schema.optional(Schema.String),
      },
      success: SettlementPage,
      error: errors,
    }),
  ),
);

export const WalletRequest = Schema.Struct({ orderId: OrderId, amountSat: Sats });
export const WalletInvoice = Schema.Struct({
  orderId: OrderId,
  amountSat: Sats,
  paymentHash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  invoice: Schema.String.check(
    Schema.isPattern(/^lnbc[0-9]+[munp]?1[0-9a-z]+$/),
    Schema.isMaxLength(4096),
  ),
  expiresAt: Schema.String,
});
export const WalletPayment = Schema.Struct({
  ...WalletInvoice.fields,
  paidAt: Schema.NullOr(Schema.String),
  receivedMsat: Schema.NullOr(Millisats),
});
export const WalletLookup = Schema.Struct({
  ...WalletRequest.fields,
  paymentHash: WalletInvoice.fields.paymentHash,
  invoice: WalletInvoice.fields.invoice,
});
export const WalletApi = HttpApi.make("LightningWalletApi").add(
  HttpApiGroup.make("wallet").add(
    HttpApiEndpoint.get("health", "/health", {
      success: Schema.Struct({ status: Schema.Literal("ok") }),
    }),
    HttpApiEndpoint.get("ready", "/ready", {
      success: Schema.Struct({ status: Schema.Literal("ok") }),
      error: errors,
    }),
    HttpApiEndpoint.post("create", "/v1/invoices", {
      headers: { authorization: Schema.optional(Schema.String) },
      payload: WalletRequest,
      success: [WalletPayment, Schema.Null.annotate({ httpApiStatus: 202 })],
      error: errors,
    }),
    HttpApiEndpoint.post("lookup", "/v1/payments/query", {
      headers: { authorization: Schema.optional(Schema.String) },
      payload: WalletLookup,
      success: [WalletPayment, Schema.Null.annotate({ httpApiStatus: 202 })],
      error: errors,
    }),
  ),
);
