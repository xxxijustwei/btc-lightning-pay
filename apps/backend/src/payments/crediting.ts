import type { WalletPayment } from "@btc-lightning-pay/api";
import { Effect } from "effect";
import type { PaymentError } from "./errors";
import { errorFields, type PaymentLog } from "./logging";
import { paymentTask } from "./runtime";
import type { createPaymentStore, OrderRow, OrderUpdate } from "./store";
import { Wallet } from "./wallet";

type Payment = typeof WalletPayment.Type;

/** Why a wallet fact contradicts its order. */
export type Anomaly =
  /** A receipt for an order that is not stored. */
  | "unknown_order"
  /** Order, invoice, hash or amount differ, or the fact cannot be read as stated. */
  | "contradicts_order"
  /** Less arrived than the invoice asked for. */
  | "underpaid"
  /** A paid order reported again with a different received amount. */
  | "amount_changed"
  /** The wallet itself refused the fact as contradicting its order (HTTP 409). */
  | "wallet_reported";
/** What a wallet fact did to its order: the order as stored now, or the anomaly it was. */
export type Credited<R = OrderRow> = { order: R } | { anomaly: Anomaly; orderId: string };
type Invoice = Pick<OrderRow, "invoice" | "paymentHash" | "expiresAt">;

/** A newly issued invoice must be the reservation's, unpaid, and carry a readable expiry. */
export function judgeInvoice(
  reservation: { id: string; amountSat: number },
  payment: Payment,
): { invoice: Invoice } | { anomaly: Anomaly } {
  const expiresAt = new Date(payment.expiresAt);
  if (
    payment.orderId !== reservation.id ||
    payment.amountSat !== reservation.amountSat ||
    payment.paidAt !== null ||
    payment.receivedMsat !== null ||
    !Number.isFinite(expiresAt.getTime())
  )
    return { anomaly: "contradicts_order" };
  return { invoice: { invoice: payment.invoice, paymentHash: payment.paymentHash, expiresAt } };
}

/**
 * Checks a wallet fact against its stored order. Paid is final; overpayment is paid, never an
 * anomaly. Without an update the order stays as stored.
 */
export function judgeReceipt(
  row: OrderRow,
  payment: Payment,
): { update?: OrderUpdate; anomaly?: Anomaly } {
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
    return { anomaly: "contradicts_order" };
  if (row.paidAt)
    return payment.paidAt && row.receivedMsat !== payment.receivedMsat
      ? { anomaly: "amount_changed" }
      : {};
  if (paidAt === null)
    return payment.receivedMsat === null
      ? { update: { expiresAt: expiry, status: "pending" } }
      : { anomaly: "contradicts_order" };
  if (payment.receivedMsat === null) return { anomaly: "contradicts_order" };
  if (payment.receivedMsat < row.amountSat * 1000) return { anomaly: "underpaid" };
  return {
    update: { expiresAt: expiry, paidAt, receivedMsat: payment.receivedMsat, status: "paid" },
  };
}

/**
 * Crediting: the one place that checks wallet facts against orders. An anomaly is a result,
 * logged here as `payment_anomaly`, and leaves the order as stored; wallet and storage outages
 * stay failures.
 */
export function createCrediting(store: ReturnType<typeof createPaymentStore>, log: PaymentLog) {
  const anomaly = (operation: string, orderId: string, reason: Anomaly) => {
    log({
      event: "payment_anomaly",
      operation,
      orderId,
      code: "PAYMENT_ANOMALY",
      anomaly: reason,
    });
    return { anomaly: reason, orderId };
  };
  const apply = (operation: string, payment: Payment) =>
    paymentTask(operation, () =>
      store.applyToOrder(payment.orderId, (row) => judgeReceipt(row, payment)),
    ).pipe(
      Effect.map((applied): Credited =>
        !applied
          ? anomaly(operation, payment.orderId, "unknown_order")
          : applied.judgement.anomaly
            ? anomaly(operation, payment.orderId, applied.judgement.anomaly)
            : { order: applied.row },
      ),
    );
  return {
    /**
     * Asks the wallet about an unpaid order and credits what it reports. An unreachable wallet
     * is logged and the order is returned as stored; joined fields of `row` are kept.
     */
    check: <R extends OrderRow>(row: R): Effect.Effect<Credited<R>, PaymentError, Wallet> =>
      Effect.gen(function* () {
        if (row.paidAt) return { order: row };
        const wallet = yield* Wallet;
        const asked = yield* wallet
          .lookup({
            orderId: row.id,
            amountSat: row.amountSat,
            paymentHash: row.paymentHash,
            invoice: row.invoice,
          })
          .pipe(
            Effect.map((payment) => ({ payment })),
            Effect.catch((error) =>
              Effect.sync((): Credited<R> => {
                if (error.reason === "mismatch")
                  return anomaly("refresh_order", row.id, "wallet_reported");
                log({ operation: "refresh_order", orderId: row.id, ...errorFields(error) });
                return { order: row };
              }),
            ),
          );
        if (!("payment" in asked)) return asked;
        const credited = yield* apply("refresh_order", asked.payment);
        return "order" in credited ? { order: { ...row, ...credited.order } } : credited;
      }).pipe(Effect.withSpan("payments.check")),
    /** Credits a receipt the wallet listed; a storage failure fails, leaving it to be re-read. */
    credit: (receipt: Payment) => apply("sync_payment", receipt),
    /**
     * Asks the wallet for a reservation's invoice and checks it. A wallet outage fails, so the
     * caller can release the reservation either way.
     */
    issueInvoice: (reservation: {
      id: string;
      amountSat: number;
    }): Effect.Effect<
      { invoice: Invoice } | { anomaly: Anomaly; orderId: string },
      PaymentError,
      Wallet
    > =>
      Effect.gen(function* () {
        const wallet = yield* Wallet;
        return yield* wallet
          .issueInvoice({ orderId: reservation.id, amountSat: reservation.amountSat })
          .pipe(
            Effect.map((payment) => {
              const judged = judgeInvoice(reservation, payment);
              return "anomaly" in judged
                ? anomaly("create_invoice", reservation.id, judged.anomaly)
                : judged;
            }),
            Effect.catch((error) =>
              error.reason === "mismatch"
                ? Effect.sync(() => anomaly("create_invoice", reservation.id, "wallet_reported"))
                : Effect.fail(error),
            ),
          );
      }),
  };
}
export type Crediting = ReturnType<typeof createCrediting>;
