import type { WalletPayment, NewOrder } from "@btc-lightning-pay/api";
import type { OrderRow } from "./store";
import { PaymentFailure } from "./errors";
export function assertSameOrder(row: OrderRow, input: typeof NewOrder.Type) {
  if (row.amountUsdCents !== input.amountUsdCents || row.reference !== (input.reference ?? ""))
    throw new PaymentFailure({ code: "IDEMPOTENCY_CONFLICT" });
}
/** Checks a newly issued, unpaid invoice before an order is stored with it. */
export function newInvoice(payment: typeof WalletPayment.Type, amountSat: number) {
  const expiresAt = new Date(payment.expiresAt);
  if (
    payment.amountSat !== amountSat ||
    payment.paidAt !== null ||
    payment.receivedMsat !== null ||
    !Number.isFinite(expiresAt.getTime())
  )
    throw new PaymentFailure({ code: "PAYMENT_MISMATCH" });
  return {
    id: payment.orderId,
    invoice: payment.invoice,
    paymentHash: payment.paymentHash,
    expiresAt,
    status: "pending",
  };
}
export function paymentUpdate(row: OrderRow, payment: typeof WalletPayment.Type) {
  const expiry = new Date(payment.expiresAt);
  const paidAt = payment.paidAt ? new Date(payment.paidAt) : null;
  if (
    row.id !== payment.orderId ||
    row.amountSat !== payment.amountSat ||
    row.paymentHash !== payment.paymentHash ||
    row.invoice !== payment.invoice ||
    !Number.isFinite(expiry.getTime()) ||
    (paidAt && !Number.isFinite(paidAt.getTime()))
  )
    throw new PaymentFailure({ code: "PAYMENT_MISMATCH" });
  if (row.paidAt) {
    if (payment.paidAt && row.receivedMsat !== payment.receivedMsat)
      throw new PaymentFailure({ code: "PAYMENT_MISMATCH" });
    return undefined;
  }
  if (
    paidAt &&
    (payment.receivedMsat === null ||
      payment.receivedMsat <= 0 ||
      payment.receivedMsat !== row.amountSat * 1000)
  )
    throw new PaymentFailure({ code: "PAYMENT_MISMATCH" });
  if (!paidAt && payment.receivedMsat !== null)
    throw new PaymentFailure({ code: "PAYMENT_MISMATCH" });
  return {
    invoice: payment.invoice,
    paymentHash: payment.paymentHash,
    expiresAt: expiry,
    paidAt,
    receivedMsat: payment.receivedMsat,
    status: paidAt ? "paid" : "pending",
  };
}
