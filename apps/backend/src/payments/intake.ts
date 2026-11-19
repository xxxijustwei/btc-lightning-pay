import type { NewOrder } from "@btc-lightning-pay/api";
import { btcQuote, merchant, paymentOrder } from "@btc-lightning-pay/db/schema";
import { and, count, eq, getTableColumns, gte, lt, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { Crediting } from "./crediting";
import { PaymentFailure, StorageFailure, type PaymentError } from "./errors";
import { errorFields, type PaymentLog } from "./logging";
import { quoteSats } from "./quote";
import { paymentTask } from "./runtime";
import {
  issued,
  type OrderRow,
  type StoredOrder,
  type Transaction,
  type TransactionRunner,
} from "./store";

export type Quote = { rateUsd: string; quotedAt: Date };
/** Two missed cron runs; an older stored quote is ignored in favour of a live fetch. */
export const STORED_QUOTE_MAX_AGE_MS = 10 * 60_000;
/** Invoices per second: per merchant, and across the platform's single shared wallet. */
export const MERCHANT_INVOICES_PER_SECOND = 5;
export const PLATFORM_INVOICES_PER_SECOND = 10;
/** Serializes admission across Worker instances; reservations are short and low-volume. */
const ADMISSION_LOCK = 1380994390;
/**
 * A reservation older than this belongs to a request that died: longer than the wallet call's
 * 15 s timeout. The same key may then take it over, and the sweep deletes it.
 */
const ABANDONED_RESERVATION = sql`interval '30 seconds'`;

function isUsable(quote: Quote, now: number) {
  const age = now - quote.quotedAt.getTime();
  // A quote from the future means clock trouble; do not trust it either.
  return age >= -60_000 && age <= STORED_QUOTE_MAX_AGE_MS;
}
function assertSameOrder(
  row: Pick<OrderRow, "amountUsdCents" | "reference">,
  input: typeof NewOrder.Type,
) {
  if (row.amountUsdCents !== input.amountUsdCents || row.reference !== (input.reference ?? ""))
    throw new PaymentFailure({ code: "IDEMPOTENCY_CONFLICT" });
}
const recentInvoices = (tx: Transaction, merchantId?: string) =>
  tx
    .select({ total: count() })
    .from(paymentOrder)
    .where(
      and(
        merchantId ? eq(paymentOrder.merchantId, merchantId) : undefined,
        gte(paymentOrder.createdAt, sql`clock_timestamp() - interval '1 second'`),
      ),
    )
    .then(([row]) => row.total);

/** The reservation transactions; Order intake's internal seam over the database. */
function reservations(transaction: TransactionRunner) {
  return {
    /**
     * Everything a create request needs before reserving, in one transaction: the merchant by
     * slug, an order already stored under this key, and the latest stored BTC quote.
     */
    async open(slug: string, key: string) {
      return transaction({ slug }, async (tx) => {
        // Reading the merchant also scopes the rest of this transaction to it.
        const [m] = await tx
          .select({
            id: merchant.id,
            enabled: merchant.enabled,
            scoped: sql<string>`set_config('app.merchant_id', ${merchant.id}, true)`,
          })
          .from(merchant)
          .where(eq(merchant.slug, slug));
        if (!m) throw new PaymentFailure({ code: "MERCHANT_NOT_FOUND" });
        // Independent reads under the scope set above, sent together to save a round trip.
        const [[order], [quote]] = await Promise.all([
          tx
            .select()
            .from(paymentOrder)
            .where(and(eq(paymentOrder.merchantId, m.id), eq(paymentOrder.key, key))),
          tx
            .select({ rateUsd: btcQuote.rateUsd, quotedAt: btcQuote.quotedAt })
            .from(btcQuote)
            .where(eq(btcQuote.source, "coinbase")),
        ]);
        return {
          merchantId: m.id,
          enabled: m.enabled,
          // A reservation is still being invoiced; only `reserve` may decide what happens to it.
          order: order && order.status !== "creating" ? issued(order) : null,
          quote: quote ?? null,
        };
      });
    },
    /**
     * Claims admission and the idempotency key before the wallet is asked for an invoice: the row
     * is stored as `creating`, so concurrent requests are counted and the key invoices only once.
     */
    async reserve(
      merchantId: string,
      key: string,
      input: typeof NewOrder.Type,
      price: Quote & { amountSat: number },
    ): Promise<{ order: OrderRow } | { reservation: StoredOrder }> {
      return transaction({ admin: true }, async (tx) => {
        const [m] = await tx
          .select()
          .from(merchant)
          .where(eq(merchant.id, merchantId))
          .for("update");
        if (!m) throw new PaymentFailure({ code: "MERCHANT_NOT_FOUND" });
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADMISSION_LOCK})`);
        const [old] = await tx
          .select({
            ...getTableColumns(paymentOrder),
            abandoned: sql<boolean>`${paymentOrder.createdAt} < clock_timestamp() - ${ABANDONED_RESERVATION}`,
          })
          .from(paymentOrder)
          .where(and(eq(paymentOrder.merchantId, merchantId), eq(paymentOrder.key, key)));
        if (old) {
          assertSameOrder(old, input);
          if (old.status !== "creating") return { order: issued(old) };
          if (!old.abandoned) throw new PaymentFailure({ code: "ORDER_IN_PROGRESS" });
          await tx.delete(paymentOrder).where(eq(paymentOrder.id, old.id));
        }
        if (!m.enabled) throw new PaymentFailure({ code: "MERCHANT_DISABLED" });
        const [ownRecent, platformRecent] = await Promise.all([
          recentInvoices(tx, merchantId),
          recentInvoices(tx),
        ]);
        if (
          ownRecent >= MERCHANT_INVOICES_PER_SECOND ||
          platformRecent >= PLATFORM_INVOICES_PER_SECOND
        )
          throw new PaymentFailure({ code: "RATE_LIMITED" });
        const [reservation] = await tx
          .insert(paymentOrder)
          .values({
            id: crypto.randomUUID(),
            merchantId,
            key,
            status: "creating",
            amountUsdCents: input.amountUsdCents,
            amountSat: price.amountSat,
            createdAt: sql`clock_timestamp()`,
            reference: input.reference ?? "",
            rateUsd: price.rateUsd,
            quotedAt: price.quotedAt,
          })
          .returning();
        return { reservation };
      });
    },
    /** Stores a checked invoice on a reservation, making it a payable order. */
    async attach(id: string, invoice: Pick<OrderRow, "invoice" | "paymentHash" | "expiresAt">) {
      return transaction({ admin: true }, async (tx) => {
        const [row] = await tx
          .update(paymentOrder)
          .set({ ...invoice, status: "pending" })
          .where(and(eq(paymentOrder.id, id), eq(paymentOrder.status, "creating")))
          .returning();
        // Released meanwhile as abandoned; the invoice was never shown, so nobody can pay it.
        if (!row) throw new StorageFailure({ operation: "attach_invoice" });
        return issued(row);
      });
    },
    /** Frees a reservation whose invoice could not be issued, so its key can be retried. */
    async release(id: string) {
      await transaction({ admin: true }, (tx) =>
        tx
          .delete(paymentOrder)
          .where(and(eq(paymentOrder.id, id), eq(paymentOrder.status, "creating"))),
      );
    },
    /** Deletes reservations left by requests that died mid-invoice; returns how many. */
    async releaseAbandoned() {
      return transaction({ admin: true }, async (tx) => {
        const rows = await tx
          .delete(paymentOrder)
          .where(
            and(
              eq(paymentOrder.status, "creating"),
              lt(paymentOrder.createdAt, sql`clock_timestamp() - ${ABANDONED_RESERVATION}`),
            ),
          )
          .returning({ id: paymentOrder.id });
        return rows.length;
      });
    },
  };
}

/**
 * Order intake: a payer's request for an order, up to a payable invoice. The idempotency key and
 * admission are claimed as a reservation before the wallet is asked, so concurrent requests can
 * neither exceed the invoice rate nor invoice one key twice; a reservation is either given its
 * invoice or deleted.
 */
export function createOrderIntake(deps: {
  transaction: TransactionRunner;
  crediting: Crediting;
  quote: (signal?: AbortSignal) => Promise<Quote>;
  log: PaymentLog;
}) {
  const { crediting, quote, log } = deps;
  const store = reservations(deps.transaction);
  /** An existing order is returned as the wallet now reports it. */
  const current = (row: OrderRow) =>
    crediting.check(row).pipe(Effect.map((result) => ("order" in result ? result.order : row)));
  return {
    /** Creates the merchant's order for this key, or returns the one already stored under it. */
    create: Effect.fn("payments.createOrder")(function* (
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
        paymentTask("open_order", () => store.open(slug, key)),
      );
      if (opened.order) {
        try {
          assertSameOrder(opened.order, input);
        } catch {
          return yield* new PaymentFailure({ code: "IDEMPOTENCY_CONFLICT" });
        }
        return yield* current(opened.order);
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
      const reserved = yield* timed(
        "reserveMs",
        paymentTask("reserve_order", () =>
          store.reserve(opened.merchantId, key, input, { ...price, amountSat }),
        ),
      );
      if ("order" in reserved) return yield* current(reserved.order);
      const id = reserved.reservation.id;
      // An anomaly was logged by Crediting; any other failure is logged here.
      const release = (operation: string, error?: unknown): Effect.Effect<never, PaymentError> =>
        Effect.gen(function* () {
          if (error !== undefined)
            log({ operation, orderId: id, durationMs: steps.invoiceMs, ...errorFields(error) });
          // A reservation left behind is deleted by the sweep.
          yield* paymentTask("release_order", () => store.release(id)).pipe(
            Effect.catch((cause) =>
              Effect.sync(() =>
                log({ operation: "release_order", orderId: id, ...errorFields(cause) }),
              ),
            ),
          );
          return yield* new PaymentFailure({ code: "WALLET_UNAVAILABLE" });
        });
      const invoiced = yield* timed("invoiceMs", crediting.issueInvoice({ id, amountSat })).pipe(
        Effect.catch((error) => release("create_invoice", error)),
      );
      if ("anomaly" in invoiced) return yield* release("create_invoice");
      const row = yield* timed(
        "storeMs",
        paymentTask("attach_invoice", () => store.attach(id, invoiced.invoice)),
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
    /** Deletes reservations whose requests died mid-invoice; returns how many. */
    sweep: () => store.releaseAbandoned(),
  };
}
export type OrderIntake = ReturnType<typeof createOrderIntake>;
