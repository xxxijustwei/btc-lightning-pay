import type { Database } from "@btc-lightning-pay/db/client";
import {
  btcQuote,
  merchant,
  paymentOrder,
  settlement,
  walletSyncCursor,
} from "@btc-lightning-pay/db/schema";
import type { WalletPayment, NewOrder } from "@btc-lightning-pay/api";
import { getTableColumns, and, count, desc, eq, gte, lt, ne, sql, type SQL } from "drizzle-orm";
import { PaymentFailure, StorageFailure } from "./errors";
import { assertSameOrder, newInvoice, paymentUpdate } from "./rules";

type StoredOrder = typeof paymentOrder.$inferSelect;
/** An order whose invoice exists: every order outside the store's reservation path. */
export type OrderRow = StoredOrder & { invoice: string; paymentHash: string; expiresAt: Date };
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Scope = {
  admin?: boolean;
  merchantId?: string;
  slug?: string;
  orderId?: string;
  repeatableRead?: boolean;
};
export type TransactionRunner = <T>(
  scope: Scope,
  body: (tx: Transaction) => Promise<T>,
) => Promise<T>;
import { createAdministrationStore } from "./administration";
import { createSettlementStore } from "./settlements";
/** Invoices per second: per merchant, and across the platform's single shared wallet. */
export const MERCHANT_INVOICES_PER_SECOND = 5;
export const PLATFORM_INVOICES_PER_SECOND = 10;
/** Serializes admission across Worker instances; reservations are short and low-volume. */
const ADMISSION_LOCK = 1380994390;
/** Longer than the wallet call's 15 s timeout: an older reservation belongs to a request that died. */
const ABANDONED_RESERVATION = sql`interval '30 seconds'`;
const issued = (row: StoredOrder) => row as OrderRow;
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
export function createPaymentStore(db: Database, signal?: AbortSignal) {
  async function transaction<T>(scope: Scope, body: (tx: Transaction) => Promise<T>) {
    return db.transaction(async (tx) => {
      signal?.throwIfAborted();
      if (scope.repeatableRead)
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
      await tx.execute(
        sql`SELECT set_config('app.payment_admin', ${scope.admin ? "true" : "false"}, true), set_config('app.merchant_id', ${scope.merchantId ?? ""}, true), set_config('app.order_id', ${scope.orderId ?? ""}, true), set_config('app.merchant_slug', ${scope.slug ?? ""}, true)`,
      );
      const result = await body(tx);
      signal?.throwIfAborted();
      return result;
    });
  }
  async function getOrder(id: string, admin = false) {
    return transaction({ admin, orderId: id }, async (tx) => {
      const [row] = await tx
        .select({ ...getTableColumns(paymentOrder), settlementStatus: settlement.status })
        .from(paymentOrder)
        .leftJoin(settlement, eq(paymentOrder.settlementId, settlement.id))
        .where(and(eq(paymentOrder.id, id), ne(paymentOrder.status, "creating")));
      if (!row) throw new PaymentFailure({ code: "ORDER_NOT_FOUND" });
      return { ...issued(row), settlementStatus: row.settlementStatus };
    });
  }
  return {
    getOrder,
    /**
     * Everything a create request needs before reserving, in one transaction: the merchant by
     * slug, an order already stored under this key, and the latest stored BTC quote.
     */
    async openOrder(slug: string, key: string) {
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
          // A reservation is still being invoiced; only reserveOrder may decide what happens to it.
          order: order && order.status !== "creating" ? issued(order) : null,
          quote: quote ?? null,
        };
      });
    },
    /**
     * Claims admission and the idempotency key before the wallet is asked for an invoice: the row
     * is stored as `creating`, so concurrent requests are counted and the key invoices only once.
     */
    async reserveOrder(
      merchantId: string,
      key: string,
      input: typeof NewOrder.Type,
      price: { rateUsd: string; quotedAt: Date; amountSat: number },
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
    /** Stores the wallet's invoice on a reservation, making it a payable order. */
    async attachInvoice(id: string, amountSat: number, payment: typeof WalletPayment.Type) {
      const { id: _id, ...invoice } = newInvoice(payment, amountSat);
      if (_id !== id) throw new PaymentFailure({ code: "PAYMENT_MISMATCH" });
      return transaction({ admin: true }, async (tx) => {
        const [row] = await tx
          .update(paymentOrder)
          .set(invoice)
          .where(and(eq(paymentOrder.id, id), eq(paymentOrder.status, "creating")))
          .returning();
        // Released meanwhile as abandoned; the invoice was never shown, so nobody can pay it.
        if (!row) throw new StorageFailure({ operation: "attach_invoice" });
        return issued(row);
      });
    },
    /** Frees a reservation whose invoice could not be issued, so its key can be retried. */
    async releaseOrder(id: string) {
      await transaction({ admin: true }, (tx) =>
        tx
          .delete(paymentOrder)
          .where(and(eq(paymentOrder.id, id), eq(paymentOrder.status, "creating"))),
      );
    },
    /** Deletes reservations left by requests that died mid-invoice; returns how many. */
    async releaseAbandonedReservations() {
      return transaction({ admin: true }, async (tx) => {
        const rows = await tx
          .delete(paymentOrder)
          .where(
            and(
              eq(paymentOrder.status, "creating"),
              lt(paymentOrder.createdAt, sql`clock_timestamp() - interval '2 minutes'`),
            ),
          )
          .returning({ id: paymentOrder.id });
        return rows.length;
      });
    },
    async walletCursor() {
      return transaction({ admin: true }, async (tx) => {
        const [row] = await tx
          .select({ syncedUntil: walletSyncCursor.syncedUntil })
          .from(walletSyncCursor)
          .where(eq(walletSyncCursor.id, "breez"));
        return row?.syncedUntil ?? null;
      });
    },
    /** Advances the payment sync cursor; it never moves backwards. */
    async saveWalletCursor(syncedUntil: Date) {
      await transaction({ admin: true }, (tx) =>
        tx
          .insert(walletSyncCursor)
          .values({ id: "breez", syncedUntil })
          .onConflictDoUpdate({
            target: walletSyncCursor.id,
            set: { syncedUntil: sql`excluded.synced_until`, updatedAt: sql`now()` },
            setWhere: sql`${walletSyncCursor.syncedUntil} < excluded.synced_until`,
          }),
      );
    },
    /** Stores the latest quote; an older quote never replaces a newer one. */
    async saveQuote(quote: { rateUsd: string; quotedAt: Date }) {
      return transaction({ admin: true }, async (tx) => {
        await tx
          .insert(btcQuote)
          .values({ source: "coinbase", ...quote })
          .onConflictDoUpdate({
            target: btcQuote.source,
            set: { rateUsd: sql`excluded.rate_usd`, quotedAt: sql`excluded.quoted_at` },
            setWhere: sql`${btcQuote.quotedAt} < excluded.quoted_at`,
          });
      });
    },
    async sync(payment: typeof WalletPayment.Type) {
      return transaction({ admin: true }, async (tx) => {
        const [row] = await tx
          .select()
          .from(paymentOrder)
          .where(and(eq(paymentOrder.id, payment.orderId), ne(paymentOrder.status, "creating")))
          .for("update");
        if (!row) throw new PaymentFailure({ code: "ORDER_NOT_FOUND" });
        const update = paymentUpdate(issued(row), payment);
        if (!update) return issued(row);
        const [updated] = await tx
          .update(paymentOrder)
          .set(update)
          .where(eq(paymentOrder.id, row.id))
          .returning();
        return issued(updated);
      });
    },
    ...createAdministrationStore(transaction),
    async merchantBySlug(slug: string) {
      return transaction({ slug }, async (tx) => {
        const [row] = await tx
          .select({ id: merchant.id, slug: merchant.slug, enabled: merchant.enabled })
          .from(merchant)
          .where(eq(merchant.slug, slug));
        if (!row) throw new PaymentFailure({ code: "MERCHANT_NOT_FOUND" });
        return row;
      });
    },
    async orders(
      query: { merchantId?: string; status?: string; from?: string; to?: string },
      limit: number,
      offset: number,
    ) {
      const conditions: SQL[] = [ne(paymentOrder.status, "creating")];
      if (query.merchantId) conditions.push(eq(paymentOrder.merchantId, query.merchantId));
      for (const [key, compare] of [
        ["from", gte],
        ["to", lt],
      ] as const)
        if (query[key]) {
          const date = new Date(query[key]);
          if (!Number.isFinite(date.getTime())) throw new PaymentFailure({ code: "INVALID_DATE" });
          conditions.push(compare(paymentOrder.createdAt, date));
        }
      if (query.status)
        conditions.push(
          sql`CASE WHEN ${paymentOrder.paidAt} IS NOT NULL THEN 'paid' WHEN ${paymentOrder.expiresAt} <= now() THEN 'expired' ELSE ${paymentOrder.status} END = ${query.status}`,
        );
      return transaction(
        { admin: true },
        async (tx) =>
          await tx
            .select({ ...getTableColumns(paymentOrder), settlementStatus: settlement.status })
            .from(paymentOrder)
            .leftJoin(settlement, eq(paymentOrder.settlementId, settlement.id))
            .where(and(...conditions))
            .orderBy(desc(paymentOrder.createdAt), paymentOrder.id)
            .limit(limit)
            .offset(offset)
            .then((rows) =>
              rows.map((row) => ({ ...issued(row), settlementStatus: row.settlementStatus })),
            ),
      );
    },
    ...createSettlementStore(transaction),
  };
}
