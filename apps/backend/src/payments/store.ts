import type { Database } from "@btc-lightning-pay/db/client";
import { merchant, paymentOrder, settlement } from "@btc-lightning-pay/db/schema";
import type { WalletPayment, NewOrder } from "@btc-lightning-pay/api";
import { getTableColumns, and, desc, eq, gte, inArray, lt, lte, sql, type SQL } from "drizzle-orm";
import { PaymentFailure } from "./errors";
import { assertSameOrder, paymentUpdate } from "./rules";

export type OrderRow = typeof paymentOrder.$inferSelect;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Scope = {
  admin?: boolean;
  merchantId?: string;
  orderId?: string;
  repeatableRead?: boolean;
};
export type TransactionRunner = <T>(
  scope: Scope,
  body: (tx: Transaction) => Promise<T>,
) => Promise<T>;
import { createSettlementStore } from "./settlements";
export function createPaymentStore(db: Database, signal?: AbortSignal) {
  async function transaction<T>(scope: Scope, body: (tx: Transaction) => Promise<T>) {
    return db.transaction(async (tx) => {
      signal?.throwIfAborted();
      if (scope.repeatableRead)
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
      await tx.execute(
        sql`SELECT set_config('app.payment_admin', ${scope.admin ? "true" : "false"}, true), set_config('app.merchant_id', ${scope.merchantId ?? ""}, true), set_config('app.order_id', ${scope.orderId ?? ""}, true)`,
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
    async attachInvoice(
      id: string,
      create: (row: OrderRow) => Promise<typeof WalletPayment.Type | null>,
    ) {
      // Lock only this order so concurrent requests cannot replace an invoice already returned to a payer.
      return transaction({ admin: true }, async (tx) => {
        const [row] = await tx
          .select()
          .from(paymentOrder)
          .where(eq(paymentOrder.id, id))
          .for("update");
        if (!row) throw new PaymentFailure({ code: "ORDER_NOT_FOUND" });
        if (row.invoice) return row;
        const payment = await create(row);
        if (!payment) return row;
        const update = paymentUpdate(row, payment);
        const [saved] = await tx
          .update(paymentOrder)
          .set(update!)
          .where(eq(paymentOrder.id, id))
          .returning();
        return saved;
      });
    },
    async findOrder(merchantId: string, key: string) {
      return transaction({ merchantId }, async (tx) => {
        const [row] = await tx
          .select()
          .from(paymentOrder)
          .where(and(eq(paymentOrder.merchantId, merchantId), eq(paymentOrder.key, key)));
        return row ?? null;
      });
    },
    async recoveryBatch() {
      return transaction({ admin: true }, async (tx) => {
        const rows = await tx
          .select()
          .from(paymentOrder)
          .where(
            and(
              inArray(paymentOrder.status, ["creating", "pending"]),
              lte(paymentOrder.attemptedAt, sql`clock_timestamp()`),
            ),
          )
          .orderBy(paymentOrder.attemptedAt, paymentOrder.id)
          .limit(500)
          .for("update", { skipLocked: true });
        if (rows.length)
          await tx
            .update(paymentOrder)
            .set({
              attemptedAt: sql`clock_timestamp() + CASE WHEN ${paymentOrder.expiresAt} < clock_timestamp() THEN interval '15 minutes' ELSE interval '1 minute' END`,
            })
            .where(
              inArray(
                paymentOrder.id,
                rows.map((r) => r.id),
              ),
            );
        return rows;
      });
    },
    async merchant(id: string) {
      return transaction({ merchantId: id }, async (tx) => {
        const [row] = await tx.select().from(merchant).where(eq(merchant.id, id));
        if (!row) throw new PaymentFailure({ code: "MERCHANT_NOT_FOUND" });
        return row;
      });
    },
    async createOrder(
      merchantId: string,
      key: string,
      input: typeof NewOrder.Type,
      price: { rateUsd: string; quotedAt: Date; amountSat: number },
    ) {
      // Serialize a merchant's admission and idempotency checks across Worker instances.
      return transaction({ merchantId }, async (tx) => {
        const [m] = await tx
          .select()
          .from(merchant)
          .where(eq(merchant.id, merchantId))
          .for("update");
        if (!m) throw new PaymentFailure({ code: "MERCHANT_NOT_FOUND" });
        const [old] = await tx
          .select()
          .from(paymentOrder)
          .where(and(eq(paymentOrder.merchantId, merchantId), eq(paymentOrder.key, key)));
        if (old) {
          assertSameOrder(old, input);
          return old;
        }
        if (!m.enabled) throw new PaymentFailure({ code: "MERCHANT_DISABLED" });
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
        if (recent.length >= 5) throw new PaymentFailure({ code: "RATE_LIMITED" });
        const [row] = await tx
          .insert(paymentOrder)
          .values({
            id: crypto.randomUUID(),
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
    async createMerchant(id: string) {
      return transaction({ admin: true }, async (tx) => {
        const [row] = await tx.insert(merchant).values({ id }).onConflictDoNothing().returning();
        if (!row) throw new PaymentFailure({ code: "MERCHANT_EXISTS" });
        return row;
      });
    },
    async merchants(limit: number, offset: number) {
      return transaction({ admin: true }, async (tx) =>
        tx.select().from(merchant).orderBy(merchant.id).limit(limit).offset(offset),
      );
    },
    async updateMerchant(id: string, enabled: boolean) {
      return transaction({ admin: true }, async (tx) => {
        const [row] = await tx
          .update(merchant)
          .set({ enabled })
          .where(eq(merchant.id, id))
          .returning();
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
