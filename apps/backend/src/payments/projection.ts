import { Schema } from "effect";
import { excessMsat, Settlement } from "@btc-lightning-pay/api";
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

export function settlementView(
  row: typeof import("@btc-lightning-pay/db/schema").settlement.$inferSelect,
) {
  const { key: _key, ...rest } = row;
  return Schema.decodeUnknownSync(Settlement)({
    ...rest,
    createdAt: row.createdAt.toISOString(),
    cutoffAt: row.cutoffAt?.toISOString() ?? null,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  });
}
