import type { WalletPayment, NewOrder, NewSettlement } from "@btc-lightning-pay/api";
import { Effect } from "effect";
import { PaymentFailure, UpstreamFailure } from "./errors";
import type { createPaymentStore, OrderRow } from "./store";
import { quoteSats } from "./quote";
import { assertSameOrder } from "./rules";
import { paymentTask } from "./runtime";
import { errorFields, type PaymentLog } from "./logging";

export type Quote = { rateUsd: string; quotedAt: Date };
/** Two missed cron runs; an older stored quote is ignored in favour of a live fetch. */
export const STORED_QUOTE_MAX_AGE_MS = 10 * 60_000;
function isUsable(quote: Quote, now: number) {
  const age = now - quote.quotedAt.getTime();
  // A quote from the future means clock trouble; do not trust it either.
  return age >= -60_000 && age <= STORED_QUOTE_MAX_AGE_MS;
}
export type WalletClient = (
  id: string,
  amountSat: number,
  signal?: AbortSignal,
  paymentHash?: string,
  invoice?: string,
) => Promise<typeof WalletPayment.Type | null>;
export function createPaymentService(
  store: ReturnType<typeof createPaymentStore>,
  quote: (signal?: AbortSignal) => Promise<Quote>,
  wallet: WalletClient,
  log: PaymentLog,
) {
  const sync = (payment: typeof WalletPayment.Type) =>
    paymentTask("confirm_payment", () => store.sync(payment));
  const walletFailure = (error: unknown) =>
    error instanceof UpstreamFailure
      ? error
      : new UpstreamFailure({ dependency: "wallet", reason: "network" });
  /** Ask the wallet whether the invoice was paid; paid orders are final. */
  const refresh = Effect.fn("payments.refresh")(function* (row: OrderRow) {
    if (row.paidAt) return row;
    const result = yield* Effect.tryPromise({
      try: (signal) => wallet(row.id, row.amountSat, signal, row.paymentHash, row.invoice),
      catch: walletFailure,
    });
    return result ? yield* sync(result) : row;
  });
  // A wallet outage keeps the stored state: an unreachable wallet never makes an order look unpaid or failed.
  const refreshOrKeep = (row: OrderRow, operation: string) =>
    refresh(row).pipe(
      Effect.catch((error) => {
        log({ operation, orderId: row.id, ...errorFields(error) });
        return error instanceof UpstreamFailure ? Effect.succeed(row) : Effect.fail(error);
      }),
    );
  return {
    order: Effect.fn("payments.order")(function* (id: string) {
      const row = yield* paymentTask("read_order", () => store.getOrder(id));
      return yield* refreshOrKeep(row, "refresh_order");
    }),
    createOrder: Effect.fn("payments.createOrder")(function* (
      slug: string,
      key: string,
      input: typeof NewOrder.Type,
    ) {
      const started = Date.now();
      const steps: Record<string, number> = {};
      const timed = <A, E>(step: string, effect: Effect.Effect<A, E>) =>
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
        return yield* refreshOrKeep(opened.order, "refresh_order");
      }
      if (!opened.enabled) return yield* new PaymentFailure({ code: "MERCHANT_DISABLED" });
      if (opened.flooded) return yield* new PaymentFailure({ code: "RATE_LIMITED" });
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
      // The invoice comes first: an order exists only once the payer has something to pay.
      // If storing fails afterwards, the invoice was never shown, so nobody can pay it.
      // A merchant disabled since the read above is refused under the lock; its invoice just expires.
      const id = crypto.randomUUID();
      const payment = yield* timed(
        "invoiceMs",
        Effect.tryPromise({
          try: async (signal) => {
            const result = await wallet(id, amountSat, signal);
            if (!result)
              throw new UpstreamFailure({ dependency: "wallet", reason: "invalid_response" });
            return result;
          },
          catch: walletFailure,
        }),
      ).pipe(
        Effect.catch((error) => {
          log({
            operation: "create_invoice",
            orderId: id,
            durationMs: steps.invoiceMs,
            ...errorFields(error),
          });
          return Effect.fail(new PaymentFailure({ code: "WALLET_UNAVAILABLE" }));
        }),
      );
      const row = yield* timed(
        "storeMs",
        paymentTask("create_order", () =>
          store.createOrder(opened.merchantId, key, input, { ...price, amountSat }, payment),
        ),
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
