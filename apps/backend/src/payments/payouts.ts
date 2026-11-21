import { Sats, type NewPayout } from "@btc-lightning-pay/api";
import { Effect } from "effect";
import { PaymentFailure } from "./errors";
import { errorFields, type PaymentLog } from "./logging";
import type { createPayoutStore, PayoutRow } from "./payout-store";
import { paymentTask } from "./task";
import { Wallet } from "./wallet";

const isActive = (row: PayoutRow) => row.status === "submitting" || row.status === "pending";

/**
 * Settlement payouts: quote, submit once, and follow the wallet until the payout settles its
 * settlement or ends. A submission whose answer is lost is never resubmitted; the sync finds it.
 */
export function createPayouts(store: ReturnType<typeof createPayoutStore>, log: PaymentLog) {
  /** Asks the wallet where an active payout stands and stores the answer. */
  const check = Effect.fn("payouts.check")(function* (row: PayoutRow) {
    if (!isActive(row)) return row;
    const wallet = yield* Wallet;
    const state = yield* wallet.payoutStatus(row.id, row.paymentId);
    return yield* paymentTask("apply_payout", () => store.applyState(row, state));
  });
  return {
    quote: Effect.fn("payouts.quote")(function* (
      settlementId: string,
      input: typeof NewPayout.Type,
      actor: string,
    ) {
      const batch = yield* paymentTask("begin_payout", () => store.beginQuote(settlementId));
      const wallet = yield* Wallet;
      const id = crypto.randomUUID();
      const quote = yield* wallet.quotePayout({
        payoutId: id,
        chain: input.chain,
        asset: input.asset,
        address: input.address,
        amountSat: Sats.make(batch.amountSat),
      });
      if (quote.payoutId !== id || quote.chain !== input.chain || quote.asset !== input.asset)
        return yield* Effect.fail(new PaymentFailure({ code: "ROUTE_UNAVAILABLE" }));
      return yield* paymentTask("save_payout", () =>
        store.insertQuote({
          id,
          settlementId,
          merchantId: batch.merchantId,
          amountSat: batch.amountSat,
          chain: quote.chain,
          chainId: quote.chainId,
          asset: quote.asset,
          assetContract: quote.contract,
          assetDecimals: quote.decimals,
          address: input.address,
          provider: quote.provider,
          providerRef: quote.providerRef,
          quoteExpiresAt: new Date(quote.expiresAt),
          valueOut: quote.valueOut,
          feeOut: quote.feeOut,
          estimatedOut: quote.estimatedOut,
          createdBy: actor,
        }),
      );
    }),
    /**
     * Submits a quoted payout once. A refusal before funds moved ends it; any other failure leaves
     * it submitting and answers `PAYOUT_OUTCOME_UNKNOWN`.
     */
    submit: Effect.fn("payouts.submit")(function* (
      settlementId: string,
      payoutId: string,
      actor: string,
    ) {
      const claim = yield* paymentTask("claim_payout", () =>
        store.beginSubmit(settlementId, payoutId, actor),
      );
      if (!claim.claimed) return yield* Effect.fail(new PaymentFailure({ code: "QUOTE_EXPIRED" }));
      const wallet = yield* Wallet;
      return yield* wallet.sendPayout(payoutId).pipe(
        Effect.flatMap(({ paymentId }) =>
          paymentTask("record_payout", () => store.recordSent(payoutId, paymentId)),
        ),
        Effect.flatMap((row) =>
          row ? Effect.succeed(row) : paymentTask("read_payout", () => store.payout(payoutId)),
        ),
        Effect.catch((error) =>
          error instanceof PaymentFailure
            ? paymentTask("refuse_payout", () =>
                store.recordRefused(
                  payoutId,
                  error.code === "QUOTE_EXPIRED" ? "expired" : "failed",
                ),
              ).pipe(Effect.andThen(Effect.fail(error)))
            : Effect.sync(() =>
                log({ operation: "submit_payout", payoutId, ...errorFields(error) }),
              ).pipe(
                Effect.andThen(Effect.fail(new PaymentFailure({ code: "PAYOUT_OUTCOME_UNKNOWN" }))),
              ),
        ),
      );
    }),
    markNotSent: (settlementId: string, payoutId: string, reason: string, actor: string) =>
      paymentTask("mark_payout_not_sent", () =>
        store.markNotSent(settlementId, payoutId, reason, actor),
      ),
    /** A settlement's payouts after asking the wallet once about the active one, if any. */
    refresh: Effect.fn("payouts.refresh")(function* (settlementId: string) {
      const rows = yield* paymentTask("read_payouts", () => store.payouts(settlementId));
      const active = rows.find(isActive);
      if (!active) return rows;
      // A failed ask leaves the payout as stored; the sync asks again.
      yield* check(active).pipe(
        Effect.catch((error) =>
          Effect.sync(() =>
            log({ operation: "check_payout", payoutId: active.id, ...errorFields(error) }),
          ),
        ),
      );
      return yield* paymentTask("read_payouts", () => store.payouts(settlementId));
    }),
    /** Every minute: expire stale quotes and follow every submitted payout. Each fails alone. */
    sync: Effect.fn("payouts.sync")(function* () {
      const expired = yield* paymentTask("expire_payout_quotes", () => store.expireQuotes());
      const open = yield* paymentTask("open_payouts", () => store.openPayouts());
      let completed = 0;
      for (const row of open) {
        const checked = yield* check(row).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              log({ operation: "sync_payout", payoutId: row.id, ...errorFields(error) });
              return row;
            }),
          ),
        );
        if (checked.status === "completed") completed++;
      }
      yield* Effect.sync(() =>
        console.info(
          JSON.stringify({ event: "payouts_synced", expired, checked: open.length, completed }),
        ),
      );
    }),
  };
}
export type Payouts = ReturnType<typeof createPayouts>;
