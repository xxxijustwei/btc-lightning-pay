import type { WalletPayment, NewOrder, NewSettlement } from "@btc-lightning-pay/api";
import { Effect } from "effect";
import { PaymentFailure, UpstreamFailure } from "./errors";
import type { createPaymentStore, OrderRow } from "./store";
import { quoteSats } from "./quote";
import { assertSameOrder } from "./rules";
import { paymentTask } from "./runtime";
import { errorFields, type PaymentLog } from "./logging";

export type Quote = { rateUsd: string; quotedAt: Date };
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
  const ensureInvoice = Effect.fn("payments.ensureInvoice")(function* (row: OrderRow) {
    if (row.paidAt) return row;
    if (!row.invoice)
      return yield* paymentTask("attach_invoice", (signal) =>
        store.attachInvoice(row.id, async (current) => {
          try {
            return await wallet(current.id, current.amountSat, signal);
          } catch (error) {
            throw error instanceof UpstreamFailure
              ? error
              : new UpstreamFailure({ dependency: "wallet", reason: "network" });
          }
        }),
      );
    const result = yield* Effect.tryPromise({
      try: (signal) => wallet(row.id, row.amountSat, signal, row.paymentHash!, row.invoice!),
      catch: (error) =>
        error instanceof UpstreamFailure
          ? error
          : new UpstreamFailure({ dependency: "wallet", reason: "network" }),
    });
    return result ? yield* sync(result) : row;
  });
  return {
    sync,
    ensureInvoice,
    order: Effect.fn("payments.order")(function* (id: string) {
      const row = yield* paymentTask("read_order", () => store.getOrder(id));
      return yield* ensureInvoice(row).pipe(
        Effect.catch((error) => {
          log({ operation: "refresh_order", orderId: id, ...errorFields(error) });
          return error instanceof UpstreamFailure ? Effect.succeed(row) : Effect.fail(error);
        }),
      );
    }),
    createOrder: Effect.fn("payments.createOrder")(function* (
      merchantId: string,
      key: string,
      input: typeof NewOrder.Type,
    ) {
      let row = yield* paymentTask("find_order", () => store.findOrder(merchantId, key));
      if (row) {
        try {
          assertSameOrder(row, input);
        } catch {
          return yield* new PaymentFailure({ code: "IDEMPOTENCY_CONFLICT" });
        }
      } else {
        const merchant = yield* paymentTask("read_merchant", () => store.merchant(merchantId));
        if (!merchant.enabled) return yield* new PaymentFailure({ code: "MERCHANT_DISABLED" });
        const quoteStarted = Date.now();
        // Fetch outside any transaction. Admission and idempotency are rechecked under the lock.
        const price = yield* Effect.tryPromise({
          try: (signal) => quote(signal),
          catch: (error) => error,
        }).pipe(
          Effect.catch((error) => {
            log({
              operation: "fetch_quote",
              durationMs: Date.now() - quoteStarted,
              ...errorFields(error),
            });
            return Effect.fail(new PaymentFailure({ code: "QUOTE_UNAVAILABLE" }));
          }),
        );
        const amountSat = yield* Effect.try({
          try: () => quoteSats(input.amountUsdCents, price.rateUsd),
          catch: () => new PaymentFailure({ code: "QUOTE_UNAVAILABLE" }),
        });
        row = yield* paymentTask("create_order", () =>
          store.createOrder(merchantId, key, input, { ...price, amountSat }),
        );
      }
      const saved = row;
      const started = Date.now();
      return yield* ensureInvoice(saved).pipe(
        Effect.catch((error) => {
          log({
            operation: "ensure_invoice",
            orderId: saved.id,
            durationMs: Date.now() - started,
            ...errorFields(error),
          });
          // The durable order remains the retry target when the provider outcome is uncertain.
          return error instanceof UpstreamFailure ? Effect.succeed(saved) : Effect.fail(error);
        }),
      );
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
