import {
  Millisats,
  satsToMsat,
  type PaymentErrorCode,
  type WalletPayment,
  type WalletPayoutState,
} from "@btc-lightning-pay/api";
import { Effect } from "effect";
import { PaymentFailure, UpstreamFailure } from "./errors";
import type { Wallet } from "./wallet";

type Payment = typeof WalletPayment.Type;
type Operation = keyof typeof Wallet.Service;
type PayoutState = typeof WalletPayoutState.Type;

/**
 * The in-memory adapter of the Wallet, for tests: it issues deterministic invoices, reports the
 * payments a test makes, and records how often each operation was asked. Production code never
 * imports it.
 */
export function memoryWallet() {
  const invoices = new Map<string, Payment>();
  const contradicted = new Set<string>();
  const failures = new Map<Operation, UpstreamFailure["reason"]>();
  const refusals = new Map<Operation, PaymentErrorCode>();
  const payoutStates = new Map<string, PayoutState>();
  const quoted = new Set<string>();
  let balanceSat = 10_000_000;
  const asked: Record<Operation, number> = {
    issueInvoice: 0,
    lookup: 0,
    completedSince: 0,
    balance: 0,
    payoutRoutes: 0,
    quotePayout: 0,
    sendPayout: 0,
    payoutStatus: 0,
  };
  /** Like `enter`, and also refuses the call when a refusal was queued for this operation. */
  const enterPayout = (operation: Operation) =>
    enter(operation).pipe(
      Effect.flatMap(() => {
        const code = refusals.get(operation);
        if (!code) return Effect.void;
        refusals.delete(operation);
        return Effect.fail(new PaymentFailure({ code }));
      }),
    );
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
      ? { ...payment, paidAt: new Date().toISOString(), receivedMsat: Millisats.make(1) }
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
    balance: () => enter("balance").pipe(Effect.map(() => ({ balanceSat }))),
    payoutRoutes: () =>
      enter("payoutRoutes").pipe(
        Effect.map(() => ({
          routes: [
            {
              chain: "base",
              chainId: "8453",
              asset: "USDC" as const,
              contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              decimals: 6,
              addressFamily: "evm" as const,
              minSat: 1200,
              maxSat: null,
              minUsdCents: 80,
              maxUsdCents: 14410000,
            },
          ],
        })),
      ),
    quotePayout: (request) =>
      enterPayout("quotePayout").pipe(
        Effect.map(() => {
          quoted.add(request.payoutId);
          return {
            payoutId: request.payoutId,
            provider: "orchestra" as const,
            providerRef: `quote-${request.payoutId}`,
            chain: request.chain,
            chainId: "8453",
            asset: request.asset,
            contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            decimals: 6,
            valueOut: String(request.amountSat * 580),
            feeOut: "300000",
            estimatedOut: String(request.amountSat * 580 - 300000),
            expiresAt: new Date(Date.now() + 120_000).toISOString(),
          };
        }),
      ),
    sendPayout: (payoutId) =>
      enterPayout("sendPayout").pipe(
        Effect.flatMap(() => {
          if (!quoted.delete(payoutId))
            return Effect.fail(new PaymentFailure({ code: "QUOTE_EXPIRED" }));
          payoutStates.set(payoutId, {
            state: "pending",
            paymentId: payoutId,
            deliveredOut: null,
            externalTx: null,
          });
          return Effect.succeed({ paymentId: payoutId });
        }),
      ),
    payoutStatus: (payoutId) =>
      enter("payoutStatus").pipe(
        Effect.map(
          () =>
            payoutStates.get(payoutId) ?? {
              state: "missing" as const,
              paymentId: null,
              deliveredOut: null,
              externalTx: null,
            },
        ),
      ),
  };
  return {
    wallet,
    asked,
    /** Sets the BTC balance the wallet reports. */
    setBalance(sats: number) {
      balanceSat = sats;
    },
    /** Sets where a payout stands as the wallet reports it. */
    setPayout(payoutId: string, state: Partial<PayoutState> & Pick<PayoutState, "state">) {
      payoutStates.set(payoutId, {
        paymentId: payoutId,
        deliveredOut: null,
        externalTx: null,
        ...state,
      });
    },
    /** Refuses the next call of a payout `operation` with `code`, before any funds move. */
    refuseNext(operation: Operation, code: PaymentErrorCode) {
      refusals.set(operation, code);
    },
    /** Marks an issued invoice paid; `receivedMsat` defaults to the invoice amount. */
    pay(orderId: string, receivedMsat?: number) {
      const issued = invoices.get(orderId);
      if (!issued) throw new Error(`No invoice issued for ${orderId}`);
      contradicted.delete(orderId);
      invoices.set(orderId, {
        ...issued,
        paidAt: new Date().toISOString(),
        receivedMsat:
          receivedMsat === undefined ? satsToMsat(issued.amountSat) : Millisats.make(receivedMsat),
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
