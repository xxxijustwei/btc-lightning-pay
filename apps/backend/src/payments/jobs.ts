import { Cause, Effect, Exit } from "effect";
import { pruneOtpThrottle } from "../auth/throttle";
import { Database, Payments, runtimeLayer, type Connect, type RuntimeBindings } from "../runtime";
import type { Crediting } from "./crediting";
import { errorFields, paymentLogger, type PaymentLog } from "./logging";
import { saveQuote } from "./quote-job";
import type { createPaymentStore } from "./store";
import { Wallet } from "./wallet";

/** Re-read receipts this far before the cursor: receipt times have one-second resolution. */
export const SYNC_OVERLAP_SECONDS = 600;

/**
 * Credits every receipt the wallet completed since the last run, whether or not anybody is
 * polling its order. Work is proportional to new receipts, not to unpaid orders. A wallet or
 * storage failure leaves the cursor in place, so the next run reads the same receipts again.
 */
export async function syncPayments(
  store: ReturnType<typeof createPaymentStore>,
  crediting: Crediting,
  wallet: typeof Wallet.Service,
  log: PaymentLog,
) {
  const cursor = await store.walletCursor();
  const since = cursor
    ? Math.max(0, Math.floor(cursor.getTime() / 1000) - SYNC_OVERLAP_SECONDS)
    : 0;
  const page = await Effect.runPromise(wallet.completedSince(since));
  let paid = 0;
  // An anomaly is logged by Crediting and skipped; a storage failure stops the run.
  for (const payment of page.payments) {
    const credited = await Effect.runPromise(crediting.credit(payment));
    if ("order" in credited && credited.order.paidAt) paid++;
  }
  if (page.latest !== null) {
    const next = new Date(page.latest * 1000);
    // More than a page inside the overlap window would never advance; it is far above capacity.
    if (page.more && cursor && next <= cursor)
      log({ operation: "sync_payments", code: "SYNC_STALLED" });
    await store.saveWalletCursor(next);
  }
  console.info(
    JSON.stringify({ event: "payments_synced", since, receipts: page.payments.length, paid }),
  );
}

/**
 * Every minute (wrangler.jsonc): sync wallet receipts, release abandoned order reservations and
 * expired sign-in throttles; every fifth minute also store a BTC quote. Each task fails alone.
 */
export async function runScheduled(
  env: RuntimeBindings,
  scheduledTime: number,
  options: { fetcher?: typeof fetch; connect?: Connect } = {},
) {
  const runId = crypto.randomUUID();
  const log = paymentLogger(runId);
  const fetcher = options.fetcher ?? fetch;
  const task = async (operation: string, work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      log({ operation, ...errorFields(error) });
    }
  };
  const run = Effect.gen(function* () {
    const { database } = yield* Database;
    const { store, crediting, intake, payouts } = yield* Payments;
    const wallet = yield* Wallet;
    yield* Effect.promise(async () => {
      if (new Date(scheduledTime).getUTCMinutes() % 5 === 0) await saveQuote(store, fetcher, log);
      // Without wallet settings the sync fails alone, logged as `not_configured`.
      await task("sync_payments", () => syncPayments(store, crediting, wallet, log));
      await task("sync_payouts", () =>
        Effect.runPromise(payouts.sync().pipe(Effect.provideService(Wallet, wallet))),
      );
      await task("release_reservations", async () => {
        const released = await intake.sweep();
        if (released)
          log({
            operation: "release_reservations",
            code: "RESERVATION_ABANDONED",
            reason: `${released} released`,
          });
      });
      await task("prune_otp_throttle", () => pruneOtpThrottle(database));
    });
  });
  const exit = await Effect.runPromiseExit(
    run.pipe(Effect.provide(runtimeLayer(env, { requestId: runId, fetcher }, options.connect))),
  );
  if (Exit.isFailure(exit))
    log({ operation: "scheduled", ...errorFields(Cause.squash(exit.cause)) });
}
