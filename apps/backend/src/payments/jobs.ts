import { createDatabase } from "@btc-lightning-pay/db/client";
import { pruneOtpThrottle } from "../auth/throttle";
import { createCrediting, type Crediting } from "./crediting";
import { errorFields, paymentLogger, type PaymentLog } from "./logging";
import { saveQuote } from "./quote-job";
import { createPaymentStore, transactionRunner } from "./store";
import { createOrderIntake } from "./intake";
import { createQuoteSource } from "./quote";
import { Effect } from "effect";
import { makeWallet, parseWalletConfig, type Wallet, type WalletConfig } from "./wallet";
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
  env: PaymentsBindings,
  scheduledTime: number,
  fetcher: typeof fetch = fetch,
) {
  const runId = crypto.randomUUID();
  const log = paymentLogger(runId);
  const url = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  if (!url) {
    log({ operation: "scheduled", code: "PAYMENTS_NOT_CONFIGURED" });
    return;
  }
  const resource = createDatabase(url);
  const store = createPaymentStore(resource.database);
  const crediting = createCrediting(store, log);
  const intake = createOrderIntake({
    transaction: transactionRunner(resource.database),
    crediting,
    quote: createQuoteSource(fetcher),
    log,
  });
  const task = async (operation: string, work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      log({ operation, ...errorFields(error) });
    }
  };
  try {
    if (new Date(scheduledTime).getUTCMinutes() % 5 === 0) await saveQuote(store, fetcher, log);
    let walletConfig: WalletConfig | undefined;
    try {
      walletConfig = parseWalletConfig(env);
    } catch {
      // The sync then fails alone, logged as `not_configured`.
    }
    const wallet = makeWallet(walletConfig, { requestId: runId, fetcher });
    await task("sync_payments", () => syncPayments(store, crediting, wallet, log));
    await task("release_reservations", async () => {
      const released = await intake.sweep();
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
