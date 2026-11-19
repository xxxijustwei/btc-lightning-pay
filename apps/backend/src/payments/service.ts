import type { NewOrder, NewSettlement } from "@btc-lightning-pay/api";
import { Effect } from "effect";
import type { Crediting } from "./crediting";
import { PaymentFailure, type PaymentError } from "./errors";
import type { createPaymentStore, OrderRow } from "./store";
import { quoteSats } from "./quote";
import { assertSameOrder } from "./rules";
import { paymentTask } from "./runtime";
import { errorFields, type PaymentLog } from "./logging";

export type Quote = { rateUsd: string; quotedAt: Date };
/** Two missed cron runs; an older stored quote is ignored in favour of a live fetch. */
export const STORED_QUOTE_MAX_AGE_MS = 10 * 60_000;
/**
 * How long after expiry a payer's poll still asks the wallet. Later receipts are found by the
 * payment sync job; admin order reads always ask.
 */
export const PUBLIC_REFRESH_AFTER_EXPIRY_MS = 10 * 60_000;
function isUsable(quote: Quote, now: number) {
  const age = now - quote.quotedAt.getTime();
  // A quote from the future means clock trouble; do not trust it either.
  return age >= -60_000 && age <= STORED_QUOTE_MAX_AGE_MS;
}
export function createPaymentService(
  store: ReturnType<typeof createPaymentStore>,
  crediting: Crediting,
  quote: (signal?: AbortSignal) => Promise<Quote>,
  log: PaymentLog,
) {
  /** The order as it stands after asking the wallet; an anomaly leaves it as stored. */
  const refresh = <R extends OrderRow>(row: R) =>
    crediting.check(row).pipe(Effect.map((result) => ("order" in result ? result.order : row)));
  return {
    /** A payer's read stops asking the wallet shortly after expiry; an admin's read always asks. */
    order: Effect.fn("payments.order")(function* (id: string, admin = false) {
      const row = yield* paymentTask("read_order", () => store.getOrder(id, admin));
      if (
        !admin &&
        !row.paidAt &&
        Date.now() > row.expiresAt.getTime() + PUBLIC_REFRESH_AFTER_EXPIRY_MS
      )
        return row;
      return yield* refresh(row);
    }),
    createOrder: Effect.fn("payments.createOrder")(function* (
      slug: string,
      key: string,
      input: typeof NewOrder.Type,
    ) {
      const started = Date.now();
      const steps: Record<string, number> = {};
      const timed = <A, E, R>(step: string, effect: Effect.Effect<A, E, R>) =>
        Effect.suspend(() => {
          const stepStarted = Date.now();
          return effect.pipe(
            Effect.ensuring(Effect.sync(() => (steps[step] = Date.now() - stepStarted))),
          );
        });
      const opened = yield* timed(
        "openMs",
        paymentTask("open_order", () => store.openOrder(slug, key)),
      );
      if (opened.order) {
        try {
          assertSameOrder(opened.order, input);
        } catch {
          return yield* new PaymentFailure({ code: "IDEMPOTENCY_CONFLICT" });
        }
        return yield* refresh(opened.order);
      }
      if (!opened.enabled) return yield* new PaymentFailure({ code: "MERCHANT_DISABLED" });
      // The cron stores a quote every five minutes; fetch live only when it has fallen behind.
      const stored = opened.quote && isUsable(opened.quote, Date.now()) ? opened.quote : null;
      const price = stored
        ? { rateUsd: stored.rateUsd, quotedAt: stored.quotedAt }
        : yield* timed(
            "quoteMs",
            Effect.tryPromise({ try: (signal) => quote(signal), catch: (error) => error }),
          ).pipe(
            Effect.catch((error) => {
              log({ operation: "fetch_quote", durationMs: steps.quoteMs, ...errorFields(error) });
              return Effect.fail(new PaymentFailure({ code: "QUOTE_UNAVAILABLE" }));
            }),
          );
      const amountSat = yield* Effect.try({
        try: () => quoteSats(input.amountUsdCents, price.rateUsd),
        catch: () => new PaymentFailure({ code: "QUOTE_UNAVAILABLE" }),
      });
      // Admission and the idempotency key are claimed before the wallet is asked, so concurrent
      // requests can neither exceed the invoice rate nor invoice one key twice.
      const reserved = yield* timed(
        "reserveMs",
        paymentTask("reserve_order", () =>
          store.reserveOrder(opened.merchantId, key, input, { ...price, amountSat }),
        ),
      );
      if ("order" in reserved) return yield* refresh(reserved.order);
      const id = reserved.reservation.id;
      // An anomaly was logged by Crediting; any other failure is logged here.
      const release = (operation: string, error?: unknown): Effect.Effect<never, PaymentError> =>
        Effect.gen(function* () {
          if (error !== undefined)
            log({ operation, orderId: id, durationMs: steps.invoiceMs, ...errorFields(error) });
          // A reservation left behind is released by the scheduled job.
          yield* paymentTask("release_order", () => store.releaseOrder(id)).pipe(
            Effect.catch((cause) =>
              Effect.sync(() =>
                log({ operation: "release_order", orderId: id, ...errorFields(cause) }),
              ),
            ),
          );
          return yield* new PaymentFailure({ code: "WALLET_UNAVAILABLE" });
        });
      const issued = yield* timed("invoiceMs", crediting.issueInvoice({ id, amountSat })).pipe(
        Effect.catch((error) => release("create_invoice", error)),
      );
      if ("anomaly" in issued) return yield* release("create_invoice");
      const row = yield* timed(
        "storeMs",
        paymentTask("attach_invoice", () => store.attachInvoice(id, issued.invoice)),
      );
      // Per-step timing shows where a slow creation spent its time; it carries no payer data.
      yield* Effect.sync(() =>
        console.info(
          JSON.stringify({
            event: "order_created",
            orderId: row.id,
            quote: stored ? "stored" : "live",
            durationMs: Date.now() - started,
            ...steps,
          }),
        ),
      );
      return row;
    }),
    settle: Effect.fn("payments.settle")(function* (
      key: string,
      input: typeof NewSettlement.Type,
      actor: string,
    ) {
      const started = Date.now();
      const result = yield* paymentTask("settle_orders", () => store.settle(key, input, actor));
      yield* Effect.sync(() =>
        console.info(
          JSON.stringify({
            event: "settlement_batch",
            settlementId: result.record.id,
            orderCount: result.record.orderCount,
            created: result.created,
            durationMs: Date.now() - started,
          }),
        ),
      );
      return result;
    }),
  };
}
