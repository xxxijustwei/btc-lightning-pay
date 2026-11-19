import { createDatabase } from "@btc-lightning-pay/db/client";
import { createPaymentStore } from "./store";
import { createQuoteSource } from "./quote";
import { errorFields, paymentLogger, type PaymentLog } from "./logging";
import type { PaymentsBindings } from "./handler";

/**
 * Fetches the Coinbase spot price and stores it, so order creation reads it from the database
 * instead of calling Coinbase. A failed run leaves the previous quote in place; once it is too
 * old, order creation falls back to a live fetch.
 */
export async function saveQuote(
  store: ReturnType<typeof createPaymentStore>,
  fetcher: typeof fetch,
  log: PaymentLog,
) {
  const started = Date.now();
  try {
    // A fresh source each run: its in-memory cache must not hand back the previous run's price.
    const quote = await createQuoteSource(fetcher)();
    await store.saveQuote(quote);
    console.info(
      JSON.stringify({
        event: "quote_refreshed",
        rateUsd: quote.rateUsd,
        quotedAt: quote.quotedAt.toISOString(),
        durationMs: Date.now() - started,
      }),
    );
  } catch (error) {
    log({ operation: "refresh_quote", durationMs: Date.now() - started, ...errorFields(error) });
  }
}

/** Stores a quote on its own database connection. */
export async function refreshQuote(env: PaymentsBindings, fetcher: typeof fetch = fetch) {
  const url = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  const log = paymentLogger(crypto.randomUUID());
  if (!url) {
    log({ operation: "refresh_quote", code: "PAYMENTS_NOT_CONFIGURED" });
    return;
  }
  const resource = createDatabase(url);
  try {
    await saveQuote(createPaymentStore(resource.database), fetcher, log);
  } finally {
    await resource.close();
  }
}
