import type { Database } from "@btc-lightning-pay/db/client";
import {
  btcQuote,
  merchant,
  paymentOrder,
  settlement,
  walletSyncCursor,
} from "@btc-lightning-pay/db/schema";
import { getTableColumns, and, desc, eq, gte, lt, ne, sql, type SQL } from "drizzle-orm";
import { PaymentFailure } from "./errors";

export type StoredOrder = typeof paymentOrder.$inferSelect;
/** An order whose invoice exists: every order outside the store's reservation path. */
export type OrderRow = StoredOrder & { invoice: string; paymentHash: string; expiresAt: Date };
export type OrderUpdate = Partial<
  Pick<StoredOrder, "expiresAt" | "paidAt" | "receivedMsat" | "status">
>;
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
/** Every stored order outside the reservation path has its invoice. */
export const issued = (row: StoredOrder) => row as OrderRow;
/** Runs a transaction under a row-level-security scope; every store is built on one of these. */
export function transactionRunner(db: Database, signal?: AbortSignal): TransactionRunner {
  return (scope, body) =>
    db.transaction(async (tx) => {
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
export function createPaymentStore(db: Database, signal?: AbortSignal) {
  const transaction = transactionRunner(db, signal);
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
    /** The latest stored BTC/USD quote; `QUOTE_UNAVAILABLE` before the first one. */
    async latestQuote() {
      return transaction({ admin: true }, async (tx) => {
        const [row] = await tx.select().from(btcQuote).where(eq(btcQuote.source, "coinbase"));
        if (!row) throw new PaymentFailure({ code: "QUOTE_UNAVAILABLE" });
        return row;
      });
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
    /**
     * Crediting's seam: locks an order, writes the update `judge` returns, and hands back the
     * order as stored now with the judgement; null when no such order exists.
     */
    async applyToOrder<J extends { update?: OrderUpdate }>(
      id: string,
      judge: (row: OrderRow) => J,
    ) {
      return transaction({ admin: true }, async (tx) => {
        const [row] = await tx
          .select()
          .from(paymentOrder)
          .where(and(eq(paymentOrder.id, id), ne(paymentOrder.status, "creating")))
          .for("update");
        if (!row) return null;
        const judgement = judge(issued(row));
        if (!judgement.update) return { row: issued(row), judgement };
        const [updated] = await tx
          .update(paymentOrder)
          .set(judgement.update)
          .where(eq(paymentOrder.id, row.id))
          .returning();
        return { row: issued(updated), judgement };
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
