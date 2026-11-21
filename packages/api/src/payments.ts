import { Context, Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSecurity,
} from "effect/http-api";

import {
  AdminOrder,
  BtcQuote,
  CancelSettlement,
  IdempotencyKey,
  ManagedUser,
  Merchant,
  MerchantId,
  MerchantSlug,
  MerchantUpdate,
  Millisats,
  NewAdmin,
  NewMerchant,
  NewOrder,
  NewPayout,
  NotSentPayout,
  NewSettlement,
  OrderId,
  PayoutAddress,
  PayoutAsset,
  PayoutChain,
  Payout,
  PayoutId,
  PayoutProvider,
  PayoutRoutes,
  PaymentProblem,
  PaymentStatus,
  PublicMerchant,
  PublicOrder,
  Sats,
  Settlement,
  SettlementDetail,
  SettlementId,
  SettlementOrderPage,
  SettlementPage,
  SettlementStatus,
  strict,
  Summary,
  TokenUnits,
  WalletBalance,
} from "./schemas";

export * from "./schemas";
const errors = [400, 401, 403, 404, 405, 409, 429, 500, 502, 503].map((httpApiStatus) =>
  PaymentProblem.annotate({ httpApiStatus }),
);
const paging = { limit: Schema.optional(Schema.String), offset: Schema.optional(Schema.String) };
const merchantParams = { merchantId: MerchantId };
const orderParams = { orderId: OrderId };
const settlementParams = { settlementId: SettlementId };
const payoutParams = { settlementId: SettlementId, payoutId: PayoutId };
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
        success: SettlementDetail,
        error: errors,
      }),
      HttpApiEndpoint.get("settlementOrders", "/api/admin/settlements/:settlementId/orders", {
        params: settlementParams,
        query: paging,
        success: SettlementOrderPage,
        error: errors,
      }),
      HttpApiEndpoint.post("quotePayout", "/api/admin/settlements/:settlementId/payouts", {
        params: settlementParams,
        payload: NewPayout,
        success: Payout.annotate({ httpApiStatus: 201 }),
        error: errors,
      }),
      HttpApiEndpoint.post(
        "submitPayout",
        "/api/admin/settlements/:settlementId/payouts/:payoutId/submit",
        { params: payoutParams, success: Payout, error: errors },
      ),
      HttpApiEndpoint.post(
        "markPayoutNotSent",
        "/api/admin/settlements/:settlementId/payouts/:payoutId/not-sent",
        { params: payoutParams, payload: NotSentPayout, success: Payout, error: errors },
      ),
      HttpApiEndpoint.get("wallet", "/api/admin/wallet", { success: WalletBalance, error: errors }),
      HttpApiEndpoint.get("quote", "/api/admin/quote", { success: BtcQuote, error: errors }),
      HttpApiEndpoint.get("payoutRoutes", "/api/admin/payouts/routes", {
        success: PayoutRoutes,
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
export const WalletPayoutQuoteRequest = Schema.Struct({
  payoutId: PayoutId,
  chain: PayoutChain,
  asset: PayoutAsset,
  address: PayoutAddress,
  amountSat: Sats,
});
/** A quote held by the wallet for `payoutId` until `expiresAt`; the whole `amountSat` is sent. */
export const WalletPayoutQuote = Schema.Struct({
  payoutId: PayoutId,
  provider: PayoutProvider,
  providerRef: Schema.String,
  chain: PayoutChain,
  chainId: Schema.NullOr(Schema.String),
  asset: PayoutAsset,
  contract: Schema.NullOr(Schema.String),
  decimals: Schema.Int,
  valueOut: TokenUnits,
  feeOut: TokenUnits,
  estimatedOut: TokenUnits,
  expiresAt: Schema.String,
});
export const WalletPayoutRef = Schema.Struct({ payoutId: PayoutId });
export const WalletPayoutSent = Schema.Struct({ paymentId: Schema.String });
export const WalletPayoutStatusRequest = Schema.Struct({
  payoutId: PayoutId,
  paymentId: Schema.NullOr(Schema.String),
});
/** Where a sent payout stands; `missing` means the wallet holds no payment for it at all. */
export const WalletPayoutState = Schema.Struct({
  state: Schema.Literals(["missing", "pending", "completed", "refunded", "failed"]),
  paymentId: Schema.NullOr(Schema.String),
  deliveredOut: Schema.NullOr(TokenUnits),
  externalTx: Schema.NullOr(Schema.String),
});
/** Wallet endpoints that touch funds require the shared bearer token; health checks do not. */
export class WalletAuth extends HttpApiMiddleware.Service<WalletAuth>()("api/WalletAuth", {
  security: { bearer: HttpApiSecurity.bearer },
}) {}
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
      payload: WalletRequest,
      success: WalletPayment,
      error: errors,
    }).middleware(WalletAuth),
    HttpApiEndpoint.post("lookup", "/v1/payments/query", {
      payload: WalletLookup,
      success: WalletPayment,
      error: errors,
    }).middleware(WalletAuth),
    HttpApiEndpoint.post("completed", "/v1/payments/completed", {
      payload: WalletCompletedRequest,
      success: WalletCompletedPage,
      error: errors,
    }).middleware(WalletAuth),
    HttpApiEndpoint.get("balance", "/v1/balance", {
      success: WalletBalance,
      error: errors,
    }).middleware(WalletAuth),
    HttpApiEndpoint.get("payoutRoutes", "/v1/payouts/routes", {
      success: PayoutRoutes,
      error: errors,
    }).middleware(WalletAuth),
    HttpApiEndpoint.post("quotePayout", "/v1/payouts/quote", {
      payload: WalletPayoutQuoteRequest,
      success: WalletPayoutQuote,
      error: errors,
    }).middleware(WalletAuth),
    HttpApiEndpoint.post("sendPayout", "/v1/payouts/send", {
      payload: WalletPayoutRef,
      success: WalletPayoutSent,
      error: errors,
    }).middleware(WalletAuth),
    HttpApiEndpoint.post("payoutStatus", "/v1/payouts/status", {
      payload: WalletPayoutStatusRequest,
      success: WalletPayoutState,
      error: errors,
    }).middleware(WalletAuth),
  ),
);
