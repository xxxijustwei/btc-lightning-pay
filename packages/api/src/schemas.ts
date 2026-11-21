/**
 * The payment DTOs and value schemas, apart from the HTTP API definitions. Browser code imports
 * this module so the endpoint tables of the other apps stay out of its bundle.
 */
import { Option, Schema } from "effect";

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
/** A struct that refuses keys it does not declare. */
export const strict = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
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
/** Whole satoshis of one order or receipt; branded so a millisatoshi value cannot stand in. */
export const Sats = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 9_007_199_254_740 }),
).pipe(Schema.brand("Sats"));
export type Sats = typeof Sats.Type;
/** Millisatoshis as Lightning reports them; branded apart from `Sats`. */
export const Millisats = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
).pipe(Schema.brand("Millisats"));
export type Millisats = typeof Millisats.Type;

const MSAT_PER_SAT = 1000;
/** The millisatoshis in whole satoshis. Every `Sats` amount fits: its maximum is chosen so. */
export const satsToMsat = (sats: Sats): Millisats => Millisats.make(sats * MSAT_PER_SAT);
/** Whole satoshis in `msat`, or `undefined` when it is not a valid whole-satoshi amount. */
export const msatToSats = (msat: number): Sats | undefined =>
  Option.getOrUndefined(Sats.makeOption(msat / MSAT_PER_SAT));
/** Millisatoshis in a satoshi count reported as `bigint`; throws when it is not a safe integer. */
export function bigintSatsToMsat(sats: bigint): Millisats {
  const msat = sats * BigInt(MSAT_PER_SAT);
  if (msat < 0n || msat > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Millisatoshi amount out of range");
  }
  return Millisats.make(Number(msat));
}
/** Millisatoshis received above an invoice of `sats`; throws when `received` is less. */
export const excessMsat = (received: Millisats, sats: Sats): Millisats =>
  Millisats.make(received - satsToMsat(sats));
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
export const SettlementDisplayStatus = Schema.Literals([
  "pending",
  "paying",
  "unconfirmed",
  "settled",
  "cancelled",
]);
export const SettlementAmount = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 2100000000000000 }),
);
export const NewSettlement = Schema.StructWithRest(Schema.Struct({ merchantId: MerchantId }), [
  Schema.Record(Schema.String, Schema.Unknown),
]).check(Schema.makeFilter((value) => Object.keys(value).every((key) => key === "merchantId")));
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
  /** `status`, except a pending settlement shows its active payout as paying or unconfirmed. */
  displayStatus: SettlementDisplayStatus,
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
export const PayoutId = Schema.String.check(Schema.isPattern(uuidV4));
export const PayoutAsset = Schema.Literals(["USDC", "USDT"]);
/** A destination chain as the wallet's cross-chain routes name it, such as `base` or `tron`. */
export const PayoutChain = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,39}$/));
export const AddressFamily = Schema.Literals(["evm", "solana", "tron"]);
export const PayoutAddress = Schema.String.check(Schema.isPattern(/^[0-9A-Za-z]{20,64}$/));
/**
 * An amount in the destination token's smallest unit. A decimal string, because an 18-decimal
 * token's amounts exceed the safe integer range.
 */
export const TokenUnits = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,39})$/));
export const PayoutProvider = Schema.Literals(["orchestra", "boltz"]);
/** A destination the platform wallet can pay from BTC, with the provider's published limits. */
export const PayoutRoute = Schema.Struct({
  chain: PayoutChain,
  chainId: Schema.NullOr(Schema.String),
  asset: PayoutAsset,
  contract: Schema.NullOr(Schema.String),
  decimals: Schema.Int,
  addressFamily: AddressFamily,
  minSat: Schema.NullOr(Schema.Int),
  maxSat: Schema.NullOr(Schema.Int),
  minUsdCents: Schema.NullOr(Schema.Int),
  maxUsdCents: Schema.NullOr(Schema.Int),
});
export const PayoutRoutes = Schema.Struct({ routes: Schema.Array(PayoutRoute) });
export const PayoutStatus = Schema.Literals([
  "quoted",
  "expired",
  "submitting",
  "pending",
  "completed",
  "refunded",
  "failed",
  "not_sent",
]);
/** `status`, except a submission whose outcome is not yet known shows as `unconfirmed`. */
export const PayoutDisplayStatus = Schema.Literals([...PayoutStatus.literals, "unconfirmed"]);
/** One attempt to pay a settlement; the settlement's whole amount, in sats, converts to `asset`. */
export const Payout = Schema.Struct({
  id: PayoutId,
  settlementId: SettlementId,
  merchantId: MerchantId,
  amountSat: SettlementAmount,
  chain: PayoutChain,
  chainId: Schema.NullOr(Schema.String),
  asset: PayoutAsset,
  contract: Schema.NullOr(Schema.String),
  decimals: Schema.Int,
  address: PayoutAddress,
  provider: PayoutProvider,
  providerRef: Schema.String,
  quoteExpiresAt: Schema.String,
  /** What `amountSat` converts to before fees; `feeOut` comes out of it, leaving `estimatedOut`. */
  valueOut: TokenUnits,
  feeOut: TokenUnits,
  estimatedOut: TokenUnits,
  status: PayoutStatus,
  displayStatus: PayoutDisplayStatus,
  paymentId: Schema.NullOr(Schema.String),
  deliveredOut: Schema.NullOr(TokenUnits),
  externalTx: Schema.NullOr(Schema.String),
  notSentReason: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  createdBy: Schema.String,
  submittedAt: Schema.NullOr(Schema.String),
  submittedBy: Schema.NullOr(Schema.String),
  resolvedAt: Schema.NullOr(Schema.String),
  resolvedBy: Schema.NullOr(Schema.String),
});
export const SettlementDetail = Schema.Struct({
  ...Settlement.fields,
  /** Every payout attempt, newest first. */
  payouts: Schema.Array(Payout),
});
export const NewPayout = strict({ chain: PayoutChain, asset: PayoutAsset, address: PayoutAddress });
export const NotSentPayout = strict({
  reason: Schema.String.check(Schema.isPattern(/\S/), Schema.isMaxLength(500)),
});
export const WalletBalance = Schema.Struct({
  balanceSat: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export const BtcQuote = Schema.Struct({
  rateUsd: Schema.String,
  source: Schema.Literal("coinbase"),
  quotedAt: Schema.String,
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
  PAYOUT_NOT_FOUND: 404,
  PAYOUT_ADDRESS_INVALID: 400,
  ADDRESS_NETWORK_MISMATCH: 400,
  AMOUNT_OUT_OF_RANGE: 409,
  ROUTE_UNAVAILABLE: 409,
  INSUFFICIENT_BALANCE: 409,
  QUOTE_EXPIRED: 409,
  PAYOUT_IN_PROGRESS: 409,
  PAYOUT_STATE_CONFLICT: 409,
  /** A payout was submitted but the wallet's answer was lost; never resubmit it. */
  PAYOUT_OUTCOME_UNKNOWN: 502,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  QUOTE_UNAVAILABLE: 503,
  WALLET_NOT_CONFIGURED: 503,
  PAYMENTS_NOT_CONFIGURED: 503,
  PAYMENTS_UNAVAILABLE: 503,
  WALLET_UNAVAILABLE: 503,
  AMOUNT_OVERFLOW: 503,
  /** Sent by an app's same-origin proxy when the backend Worker cannot be reached. */
  BACKEND_UNAVAILABLE: 502,
} as const;
export type PaymentErrorCode = keyof typeof paymentErrorStatus;
export const PaymentProblem = Schema.Struct({
  code: Schema.Literals(Object.keys(paymentErrorStatus) as PaymentErrorCode[]),
  message: Schema.String,
});
