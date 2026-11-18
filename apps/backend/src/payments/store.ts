import type { Database } from "@btc-lightning-pay/db/client";
import { btcQuote, merchant, paymentOrder, settlement } from "@btc-lightning-pay/db/schema";
import type { WalletPayment, NewOrder } from "@btc-lightning-pay/api";
import { getTableColumns, and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { PaymentFailure } from "./errors";
import { assertSameOrder, newInvoice, paymentUpdate } from "./rules";

export type OrderRow = typeof paymentOrder.$inferSelect;
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
/** Admission allows five new orders per merchant per second, timed by the database clock. */
async function isFlooded(tx: Transaction, merchantId: string) {
  const recent = await tx
    .select({ id: paymentOrder.id })
    .from(paymentOrder)
    .where(
      and(
        eq(paymentOrder.merchantId, merchantId),
        gte(paymentOrder.createdAt, sql`clock_timestamp() - interval '1 second'`),
      ),
    )
    .limit(5);
  return recent.length >= 5;
}
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
        .where(eq(paymentOrder.id, id));
      if (!row) throw new PaymentFailure({ code: "ORDER_NOT_FOUND" });
      return row;
    });
  }
  return {
    getOrder,
    async findOrder(merchantId: string, key: string) {
      return transaction({ merchantId }, async (tx) => {
        const [row] = await tx
          .select()
          .from(paymentOrder)
          .where(and(eq(paymentOrder.merchantId, merchantId), eq(paymentOrder.key, key)));
        return row ?? null;
      });
    },
    /**
     * Everything a create request needs before invoicing, in one transaction: the merchant by
     * slug, an order already stored under this key, whether admission would refuse a new one,
     * and the latest stored BTC quote.
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
        const [[order], flooded, [quote]] = await Promise.all([
          tx
            .select()
            .from(paymentOrder)
            .where(and(eq(paymentOrder.merchantId, m.id), eq(paymentOrder.key, key))),
          isFlooded(tx, m.id),
          tx
            .select({ rateUsd: btcQuote.rateUsd, quotedAt: btcQuote.quotedAt })
            .from(btcQuote)
            .where(eq(btcQuote.source, "coinbase")),
        ]);
        return {
          merchantId: m.id,
          enabled: m.enabled,
          order: order ?? null,
          flooded,
          quote: quote ?? null,
        };
      });
    },
    async createOrder(
      merchantId: string,
      key: string,
      input: typeof NewOrder.Type,
      price: { rateUsd: string; quotedAt: Date; amountSat: number },
      payment: typeof WalletPayment.Type,
    ) {
      const invoice = newInvoice(payment, price.amountSat);
      // Serialize a merchant's admission and idempotency checks across Worker instances.
      return transaction({ merchantId }, async (tx) => {
        const [m] = await tx
          .select()
          .from(merchant)
          .where(eq(merchant.id, merchantId))
          .for("update");
        if (!m) throw new PaymentFailure({ code: "MERCHANT_NOT_FOUND" });
        // Both reads run after the lock above is held, so sending them together stays serialized.
        const [[old], flooded] = await Promise.all([
          tx
            .select()
            .from(paymentOrder)
            .where(and(eq(paymentOrder.merchantId, merchantId), eq(paymentOrder.key, key))),
          isFlooded(tx, merchantId),
        ]);
        if (old) {
          // A concurrent retry won; its invoice is the one the payer sees, this one is never shown.
          assertSameOrder(old, input);
          return old;
        }
        if (!m.enabled) throw new PaymentFailure({ code: "MERCHANT_DISABLED" });
        if (flooded) throw new PaymentFailure({ code: "RATE_LIMITED" });
        const [row] = await tx
          .insert(paymentOrder)
          .values({
            ...invoice,
            merchantId,
            key,
            amountUsdCents: input.amountUsdCents,
            amountSat: price.amountSat,
            createdAt: sql`clock_timestamp()`,
            reference: input.reference ?? "",
            rateUsd: price.rateUsd,
            quotedAt: price.quotedAt,
          })
          .returning();
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
    async sync(payment: typeof WalletPayment.Type) {
      return transaction({ admin: true }, async (tx) => {
        const [row] = await tx
          .select()
          .from(paymentOrder)
          .where(eq(paymentOrder.id, payment.orderId))
          .for("update");
        if (!row) throw new PaymentFailure({ code: "ORDER_NOT_FOUND" });
        const update = paymentUpdate(row, payment);
        if (!update) return row;
        const [updated] = await tx
          .update(paymentOrder)
          .set(update)
          .where(eq(paymentOrder.id, row.id))
          .returning();
        return updated;
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
      const conditions: SQL[] = [];
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
            .offset(offset),
      );
    },
    ...createSettlementStore(transaction),
  };
}
