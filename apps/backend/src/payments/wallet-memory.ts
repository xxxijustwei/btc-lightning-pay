import type { WalletPayment } from "@btc-lightning-pay/api";
import { Effect } from "effect";
import { UpstreamFailure } from "./errors";
import type { Wallet } from "./wallet";

type Payment = typeof WalletPayment.Type;
type Operation = keyof typeof Wallet.Service;

/**
 * The in-memory adapter of the Wallet, for tests: it issues deterministic invoices, reports the
 * payments a test makes, and records how often each operation was asked. Production code never
 * imports it.
 */
export function memoryWallet() {
  const invoices = new Map<string, Payment>();
  const contradicted = new Set<string>();
  const failures = new Map<Operation, UpstreamFailure["reason"]>();
  const asked: Record<Operation, number> = { issueInvoice: 0, lookup: 0, completedSince: 0 };
  /** Counts the call and fails it when a failure was queued for this operation. */
  const enter = (operation: Operation) =>
    Effect.suspend(() => {
      asked[operation]++;
      const reason = failures.get(operation);
      if (!reason) return Effect.void;
      failures.delete(operation);
      return Effect.fail(
        new UpstreamFailure({
          dependency: "wallet",
          reason,
          upstreamStatus: reason === "mismatch" ? 409 : reason === "http" ? 502 : undefined,
        }),
      );
    });
  /** What the wallet reports for an order now: a contradicted order reads as paid with 1 msat. */
  const report = (payment: Payment): Payment =>
    contradicted.has(payment.orderId)
      ? { ...payment, paidAt: new Date().toISOString(), receivedMsat: 1 }
      : payment;
  const wallet: typeof Wallet.Service = {
    issueInvoice: ({ orderId, amountSat }) =>
      enter("issueInvoice").pipe(
        Effect.map(() => {
          const payment: Payment = {
            orderId,
            amountSat,
            invoice: "lnbc100u1test",
            paymentHash: orderId.replaceAll("-", "").repeat(2),
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            paidAt: null,
            receivedMsat: null,
          };
          invoices.set(orderId, payment);
          return payment;
        }),
      ),
    lookup: (request) =>
      enter("lookup").pipe(
        Effect.flatMap(() => {
          const issued = invoices.get(request.orderId) ?? {
            ...request,
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            paidAt: null,
            receivedMsat: null,
          };
          // The wallet refuses a lookup whose invoice is not the one it issued.
          return issued.paymentHash === request.paymentHash && issued.invoice === request.invoice
            ? Effect.succeed(report(issued))
            : Effect.fail(
                new UpstreamFailure({
                  dependency: "wallet",
                  reason: "mismatch",
                  upstreamStatus: 409,
                }),
              );
        }),
      ),
    completedSince: (since) =>
      enter("completedSince").pipe(
        Effect.map(() => {
          const payments = [...invoices.values()]
            .map(report)
            .filter((payment) => payment.paidAt && Date.parse(payment.paidAt) / 1000 >= since);
          const times = payments.map((payment) => Math.floor(Date.parse(payment.paidAt!) / 1000));
          return { payments, latest: times.length ? Math.max(...times) : null, more: false };
        }),
      ),
  };
  return {
    wallet,
    asked,
    /** Marks an issued invoice paid; `receivedMsat` defaults to the invoice amount. */
    pay(orderId: string, receivedMsat?: number) {
      const issued = invoices.get(orderId);
      if (!issued) throw new Error(`No invoice issued for ${orderId}`);
      contradicted.delete(orderId);
      invoices.set(orderId, {
        ...issued,
        paidAt: new Date().toISOString(),
        receivedMsat: receivedMsat ?? issued.amountSat * 1000,
      });
    },
    /** From now on the wallet reports a fact that contradicts the order, until it is paid. */
    contradict(orderId: string) {
      contradicted.add(orderId);
    },
    /** Fails the next call of `operation` with `reason`. */
    failNext(operation: Operation, reason: UpstreamFailure["reason"]) {
      failures.set(operation, reason);
    },
  };
}
export type MemoryWallet = ReturnType<typeof memoryWallet>;
