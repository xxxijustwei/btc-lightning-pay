import { createDatabase } from "@btc-lightning-pay/db/client";
import { pruneOtpThrottle } from "../auth/throttle";
import { PaymentFailure } from "./errors";
import { errorFields, paymentLogger, type PaymentLog } from "./logging";
import { saveQuote } from "./quote-job";
import { createPaymentStore } from "./store";
import { createWalletLister, parseWalletConfig, type WalletLister } from "./wallet-client";
import type { PaymentsBindings } from "./handler";

/** Re-read receipts this far before the cursor: receipt times have one-second resolution. */
export const SYNC_OVERLAP_SECONDS = 600;

/**
 * Credits every receipt the wallet completed since the last run, whether or not anybody is
 * polling its order. Work is proportional to new receipts, not to unpaid orders. A wallet or
 * storage failure leaves the cursor in place, so the next run reads the same receipts again.
 */
export async function syncPayments(
  store: ReturnType<typeof createPaymentStore>,
  list: WalletLister,
  log: PaymentLog,
) {
  const cursor = await store.walletCursor();
  const since = cursor
    ? Math.max(0, Math.floor(cursor.getTime() / 1000) - SYNC_OVERLAP_SECONDS)
    : 0;
  const page = await list(since);
  let paid = 0;
  for (const payment of page.payments) {
    try {
      if ((await store.sync(payment)).paidAt) paid++;
    } catch (error) {
      // A receipt that matches no order, or contradicts its order, is reported and skipped.
      if (
        error instanceof PaymentFailure &&
        (error.code === "ORDER_NOT_FOUND" || error.code === "PAYMENT_MISMATCH")
      ) {
        log({
          event: "payment_anomaly",
          operation: "sync_payment",
          orderId: payment.orderId,
          code: error.code,
        });
        continue;
      }
      throw error;
    }
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
  env: PaymentsBindings,
  scheduledTime: number,
  fetcher: typeof fetch = fetch,
) {
  const log = paymentLogger(crypto.randomUUID());
  const url = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  if (!url) {
    log({ operation: "scheduled", code: "PAYMENTS_NOT_CONFIGURED" });
    return;
  }
  const resource = createDatabase(url);
  const store = createPaymentStore(resource.database);
  const task = async (operation: string, work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      log({ operation, ...errorFields(error) });
    }
  };
  try {
    if (new Date(scheduledTime).getUTCMinutes() % 5 === 0) await saveQuote(store, fetcher, log);
    await task("sync_payments", async () =>
      syncPayments(store, createWalletLister(parseWalletConfig(env), fetcher), log),
    );
    await task("release_reservations", async () => {
      const released = await store.releaseAbandonedReservations();
      if (released)
        log({
          operation: "release_reservations",
          code: "RESERVATION_ABANDONED",
          reason: `${released} released`,
        });
    });
    await task("prune_otp_throttle", () => pruneOtpThrottle(resource.database));
  } finally {
    await resource.close();
  }
}
