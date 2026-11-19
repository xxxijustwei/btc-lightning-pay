import { Context, Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware } from "effect/http-api";

export const MerchantSlug = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{2,31}$/));
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const OrderId = Schema.String.check(Schema.isPattern(uuidV4));
export const MerchantId = Schema.String.check(Schema.isPattern(uuidV4));
export const SettlementId = Schema.String.check(Schema.isPattern(uuidV4));
export const AccountName = Schema.String.check(Schema.isPattern(/\S/), Schema.isMaxLength(100));
export const AccountEmail = Schema.String.check(
  Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
  Schema.isMaxLength(254),
);
const strict = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.StructWithRest(Schema.Struct(fields), [
    Schema.Record(Schema.String, Schema.Unknown),
  ]).check(
    Schema.makeFilter((value) => Object.keys(value).every((key) => Object.hasOwn(fields, key))),
  );
export const NewAdmin = strict({ name: AccountName, email: AccountEmail });
export const NewMerchant = strict({ name: AccountName, email: AccountEmail, slug: MerchantSlug });
export const MerchantUpdate = strict({
  name: Schema.optional(AccountName),
  enabled: Schema.optional(Schema.Boolean),
}).check(Schema.makeFilter((value) => Object.keys(value).length > 0));
export const ManagedUser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  role: Schema.Literals(["admin", "merchant"]),
  banned: Schema.Boolean,
  merchantId: Schema.NullOr(MerchantId),
  createdAt: Schema.String,
});
export const IdempotencyKey = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{16,128}$/));
export const Sats = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9_007_199_254_740 }));
export const Millisats = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
export const UsdCents = Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 30000 }));
export const Reference = Schema.String.check(Schema.isMaxLength(128));
export const NewOrder = Schema.Struct({
  amountUsdCents: UsdCents,
  reference: Schema.optional(Reference),
});
// An order is stored only once its invoice exists, so every order starts pending.
export const PaymentStatus = Schema.Literals(["pending", "paid", "expired"]);
export const PublicMerchant = Schema.Struct({
  merchantId: MerchantId,
  slug: MerchantSlug,
  enabled: Schema.Boolean,
  currency: Schema.Literal("USD"),
  minAmountUsdCents: Schema.Literal(100),
  maxAmountUsdCents: Schema.Literal(30000),
});
export const PublicOrder = Schema.Struct({
  id: OrderId,
  merchantId: MerchantId,
  amountUsdCents: UsdCents,
  amountSat: Sats,
  status: PaymentStatus,
  invoice: Schema.String,
  expiresAt: Schema.String,
  serverTime: Schema.String,
});
export const Merchant = Schema.Struct({
  id: MerchantId,
  slug: MerchantSlug,
  name: AccountName,
  email: AccountEmail,
  userId: Schema.String,
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
  paymentHash: Schema.String,
  receivedMsat: Schema.NullOr(Millisats),
  /** Received beyond the invoice amount; recorded for the platform, never paid to the merchant. */
  excessMsat: Schema.NullOr(Millisats),
  settlementId: Schema.NullOr(SettlementId),
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
  id: SettlementId,
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
  /** Unexpired invoices still awaiting payment. */
  unconfirmedOrderCount: Schema.Int,
});
export const paymentErrorStatus = {
  INVALID_INPUT: 400,
  BODY_TOO_LARGE: 400,
  INVALID_DATE: 400,
  INVALID_PAGINATION: 400,
  UNAUTHORIZED: 401,
  ADMIN_REQUIRED: 403,
  ORIGIN_REJECTED: 403,
  NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  MERCHANT_NOT_FOUND: 404,
  ORDER_NOT_FOUND: 404,
  SETTLEMENT_NOT_FOUND: 404,
  EMAIL_EXISTS: 409,
  LAST_ADMIN: 409,
  USER_IS_MERCHANT: 409,
  NO_ELIGIBLE_ORDERS: 409,
  SETTLEMENT_STATE_CONFLICT: 409,
  SETTLEMENT_PROOF_CONFLICT: 409,
  SETTLEMENT_REASON_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  ORDER_IN_PROGRESS: 409,
  MERCHANT_DISABLED: 409,
  MERCHANT_EXISTS: 409,
  PAYMENT_MISMATCH: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  QUOTE_UNAVAILABLE: 503,
  WALLET_NOT_CONFIGURED: 503,
  PAYMENTS_NOT_CONFIGURED: 503,
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
const settlementParams = { settlementId: SettlementId };
const idempotencyHeaders = { "idempotency-key": IdempotencyKey };
/** The enabled admin an admin request acts as, established once by `AdminSession`. */
export class AdminActor extends Context.Service<AdminActor, { readonly id: string }>()(
  "api/AdminActor",
) {}
/**
 * Runs before every admin endpoint: checks the request's origin and admin session, then provides
 * `AdminActor`. Implemented by the backend; clients need nothing.
 */
export class AdminSession extends HttpApiMiddleware.Service<
  AdminSession,
  { provides: AdminActor }
>()("api/AdminSession") {}
export const PaymentsApi = HttpApi.make("PaymentsApi").add(
  HttpApiGroup.make("publicPayments").add(
    HttpApiEndpoint.get("merchant", "/api/public/merchants/:slug", {
      params: { slug: MerchantSlug },
      success: PublicMerchant,
      error: errors,
    }),
    HttpApiEndpoint.post("createOrder", "/api/public/merchants/:slug/orders", {
      params: { slug: MerchantSlug },
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
  HttpApiGroup.make("adminPayments")
    .add(
      HttpApiEndpoint.post("createAdmin", "/api/admin/users", {
        payload: NewAdmin,
        success: ManagedUser,
        error: errors,
      }),
      HttpApiEndpoint.get("users", "/api/admin/users", {
        query: { ...paging, role: Schema.optional(Schema.Literals(["admin", "merchant"])) },
        success: Schema.Array(ManagedUser),
        error: errors,
      }),
      HttpApiEndpoint.get("user", "/api/admin/users/:userId", {
        params: { userId: Schema.String },
        success: ManagedUser,
        error: errors,
      }),
      HttpApiEndpoint.patch("updateUser", "/api/admin/users/:userId", {
        params: { userId: Schema.String },
        payload: strict({ banned: Schema.Boolean }),
        success: ManagedUser,
        error: errors,
      }),
      HttpApiEndpoint.get("merchant", "/api/admin/merchants/:merchantId", {
        params: merchantParams,
        success: Merchant,
        error: errors,
      }),
      HttpApiEndpoint.post("createMerchant", "/api/admin/merchants", {
        payload: NewMerchant,
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
        payload: MerchantUpdate,
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
      HttpApiEndpoint.get("settlement", "/api/admin/settlements/:settlementId", {
        params: settlementParams,
        success: Settlement,
        error: errors,
      }),
      HttpApiEndpoint.get("settlementOrders", "/api/admin/settlements/:settlementId/orders", {
        params: settlementParams,
        query: paging,
        success: SettlementOrderPage,
        error: errors,
      }),
      HttpApiEndpoint.post("confirmSettlement", "/api/admin/settlements/:settlementId/confirm", {
        params: settlementParams,
        payload: ConfirmSettlement,
        success: Settlement,
        error: errors,
      }),
      HttpApiEndpoint.post("cancelSettlement", "/api/admin/settlements/:settlementId/cancel", {
        params: settlementParams,
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
    )
    .middleware(AdminSession),
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
/** Completed receipts since a Unix time in seconds, oldest first, at most one page. */
export const WalletCompletedRequest = Schema.Struct({
  since: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4_102_444_800 })),
});
export const WalletCompletedPage = Schema.Struct({
  payments: Schema.Array(WalletPayment),
  /** Latest receipt time seen on this page, including receipts that are not order invoices. */
  latest: Schema.NullOr(Schema.Int),
  /** True when the page was full and more receipts may follow `latest`. */
  more: Schema.Boolean,
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
      success: WalletPayment,
      error: errors,
    }),
    HttpApiEndpoint.post("lookup", "/v1/payments/query", {
      headers: { authorization: Schema.optional(Schema.String) },
      payload: WalletLookup,
      success: WalletPayment,
      error: errors,
    }),
    HttpApiEndpoint.post("completed", "/v1/payments/completed", {
      headers: { authorization: Schema.optional(Schema.String) },
      payload: WalletCompletedRequest,
      success: WalletCompletedPage,
      error: errors,
    }),
  ),
);
