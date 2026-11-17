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
    expiresAt: row.expiresAt?.toISOString() ?? null,
    serverTime: new Date().toISOString(),
  };
}
export function adminOrder(row: OrderRow) {
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
    feeMsat: row.feeMsat,
    settlementId: row.settlementId,
  };
}
export function statusOf(row: OrderRow): typeof PaymentStatus.Type {
  if (row.paidAt) return "paid";
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return "expired";
  if (row.invoice) return "pending";
  return row.status === "failed" ? "failed" : "creating";
}
