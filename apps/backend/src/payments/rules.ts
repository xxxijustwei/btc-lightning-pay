import type { GatewayPayment, NewOrder } from "@btc-lightning-pay/api";
import type { OrderRow } from "./store";
import { PaymentFailure } from "./errors";
export function assertSameOrder(row: OrderRow, input: typeof NewOrder.Type) {
  if (row.amountUsdCents !== input.amountUsdCents || row.reference !== (input.reference ?? ""))
    throw new PaymentFailure({ code: "IDEMPOTENCY_CONFLICT" });
}
export function paymentUpdate(row: OrderRow, payment: typeof GatewayPayment.Type) {
  const expiry = new Date(payment.expiresAt);
  const paidAt = payment.paidAt ? new Date(payment.paidAt) : null;
  if (
    row.id !== payment.orderId ||
    row.amountSat !== payment.amountSat ||
    (row.paymentHash && row.paymentHash !== payment.paymentHash) ||
    (row.invoice && row.invoice !== payment.invoice) ||
    !Number.isFinite(expiry.getTime()) ||
    (paidAt && !Number.isFinite(paidAt.getTime()))
  )
    throw new PaymentFailure({ code: "PAYMENT_MISMATCH" });
  if (row.paidAt) {
    if (
      payment.paidAt &&
      (row.receivedMsat !== payment.receivedMsat || row.feeMsat !== payment.feeMsat)
    )
      throw new PaymentFailure({ code: "PAYMENT_MISMATCH" });
    return undefined;
  }
  if (
    paidAt &&
    (payment.receivedMsat === null ||
      payment.receivedMsat <= 0 ||
      payment.feeMsat === null ||
      payment.receivedMsat + payment.feeMsat !== row.amountSat * 1000)
  )
    throw new PaymentFailure({ code: "PAYMENT_MISMATCH" });
  if (!paidAt && (payment.receivedMsat !== null || payment.feeMsat !== null))
    throw new PaymentFailure({ code: "PAYMENT_MISMATCH" });
  return {
    invoice: payment.invoice,
    paymentHash: payment.paymentHash,
    expiresAt: expiry,
    paidAt,
    receivedMsat: payment.receivedMsat,
    feeMsat: payment.feeMsat,
    status: paidAt ? "paid" : "pending",
  };
}
