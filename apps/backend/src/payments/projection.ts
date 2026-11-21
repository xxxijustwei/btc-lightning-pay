import { Schema } from "effect";
import { excessMsat, Payout, Settlement, SettlementDetail } from "@btc-lightning-pay/api";
import type { settlement } from "@btc-lightning-pay/db/schema";
import { isUnconfirmed, type PayoutRow } from "./payout-store";
import type { PaymentStatus } from "@btc-lightning-pay/api";
import type { OrderRow } from "./store";
export function publicOrder(row: OrderRow) {
  return {
    id: row.id,
    merchantId: row.merchantId,
    amountUsdCents: row.amountUsdCents,
    amountSat: row.amountSat,
    status: statusOf(row),
    invoice: row.invoice,
    expiresAt: row.expiresAt.toISOString(),
    serverTime: new Date().toISOString(),
  };
}
export function adminOrder(row: OrderRow & { settlementStatus?: string | null }) {
  return {
    ...publicOrder(row),
    reference: row.reference,
    rateUsd: row.rateUsd,
    rateSource: "coinbase" as const,
    quotedAt: row.quotedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    paymentHash: row.paymentHash,
    receivedMsat: row.receivedMsat,
    excessMsat: row.receivedMsat === null ? null : excessMsat(row.receivedMsat, row.amountSat),
    settlementId: row.settlementId,
    settlementStatus:
      row.settlementStatus === "pending"
        ? ("pending" as const)
        : row.settlementStatus === "settled"
          ? ("settled" as const)
          : null,
  };
}
export function statusOf(row: OrderRow): typeof PaymentStatus.Type {
  if (row.paidAt) return "paid";
  return row.expiresAt.getTime() <= Date.now() ? "expired" : "pending";
}

type SettlementRow = typeof settlement.$inferSelect & { displayStatus: string };
const iso = (date: Date | null) => date?.toISOString() ?? null;
export function settlementView(row: SettlementRow) {
  const { key: _key, ...rest } = row;
  return Schema.decodeUnknownSync(Settlement)({
    ...rest,
    createdAt: row.createdAt.toISOString(),
    cutoffAt: iso(row.cutoffAt),
    confirmedAt: iso(row.confirmedAt),
    cancelledAt: iso(row.cancelledAt),
  });
}
export function payoutView(row: PayoutRow) {
  return Schema.decodeUnknownSync(Payout)({
    id: row.id,
    settlementId: row.settlementId,
    merchantId: row.merchantId,
    amountSat: row.amountSat,
    chain: row.chain,
    chainId: row.chainId,
    asset: row.asset,
    contract: row.assetContract,
    decimals: row.assetDecimals,
    address: row.address,
    provider: row.provider,
    providerRef: row.providerRef,
    quoteExpiresAt: row.quoteExpiresAt.toISOString(),
    valueOut: row.valueOut,
    feeOut: row.feeOut,
    estimatedOut: row.estimatedOut,
    status: row.status,
    displayStatus: isUnconfirmed(row) ? "unconfirmed" : row.status,
    paymentId: row.paymentId,
    deliveredOut: row.deliveredOut,
    externalTx: row.externalTx,
    notSentReason: row.notSentReason,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    submittedAt: iso(row.submittedAt),
    submittedBy: row.submittedBy,
    resolvedAt: iso(row.resolvedAt),
    resolvedBy: row.resolvedBy,
  });
}
export function settlementDetail(row: SettlementRow, payouts: PayoutRow[]) {
  return Schema.decodeUnknownSync(SettlementDetail)({
    ...settlementView(row),
    payouts: payouts.map(payoutView),
  });
}
