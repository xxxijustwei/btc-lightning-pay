import type { Database } from "@btc-lightning-pay/db/client";
import { merchant, paymentOrder, settlement } from "@btc-lightning-pay/db/schema";
import type { GatewayPayment, NewOrder, NewSettlement } from "@btc-lightning-pay/api";
import { and, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { PaymentFailure } from "./errors";
import { assertSameOrder, paymentUpdate, assertSettlement } from "./rules";

export type OrderRow = typeof paymentOrder.$inferSelect;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Scope = { admin?: boolean; merchantId?: string; orderId?: string };
export function createPaymentStore(db: Database, signal?: AbortSignal) {
  async function transaction<T>(scope: Scope, body: (tx: Transaction) => Promise<T>) {
    return db.transaction(async (tx) => {
      signal?.throwIfAborted();
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
      const [row] = await tx.select().from(paymentOrder).where(eq(paymentOrder.id, id));
      if (!row) throw new PaymentFailure({ code: "ORDER_NOT_FOUND" });
      return row;
    });
  }
  return {
    getOrder,
    async attachInvoice(
      id: string,
      create: (row: OrderRow) => Promise<typeof GatewayPayment.Type | null>,
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
          .where(inArray(paymentOrder.status, ["creating", "pending"]))
          .orderBy(paymentOrder.attemptedAt, paymentOrder.id)
          .limit(50)
          .for("update", { skipLocked: true });
        if (rows.length)
          await tx
            .update(paymentOrder)
            .set({ attemptedAt: new Date() })
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
    async sync(payment: typeof GatewayPayment.Type) {
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
            .select()
            .from(paymentOrder)
            .where(and(...conditions))
            .orderBy(desc(paymentOrder.createdAt), paymentOrder.id)
            .limit(limit)
            .offset(offset),
      );
    },
    async summary(merchantId: string) {
      return transaction({ admin: true }, async (tx) => {
        const [m] = await tx.select().from(merchant).where(eq(merchant.id, merchantId));
        if (!m) throw new PaymentFailure({ code: "MERCHANT_NOT_FOUND" });
        const [totals] = await tx
          .select({
            paid: sql<string>`coalesce(sum(${paymentOrder.amountSat}),0)::text`,
            settled: sql<string>`coalesce(sum(case when ${paymentOrder.settlementId} IS NOT NULL then ${paymentOrder.amountSat} else 0 end),0)::text`,
          })
          .from(paymentOrder)
          .where(and(eq(paymentOrder.merchantId, merchantId), eq(paymentOrder.status, "paid")));
        const paidSat = Number(totals.paid),
          settledSat = Number(totals.settled);
        if (!Number.isSafeInteger(paidSat) || !Number.isSafeInteger(settledSat))
          throw new PaymentFailure({ code: "AMOUNT_OVERFLOW" });
        return { merchantId, paidSat, settledSat, unsettledSat: paidSat - settledSat };
      });
    },
    async settle(key: string, input: typeof NewSettlement.Type, actor: string) {
      const ids = [...input.orderIds].sort();
      if (new Set(ids).size !== ids.length) throw new PaymentFailure({ code: "DUPLICATE_ORDER" });
      return transaction({ admin: true }, async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`);
        const [old] = await tx.select().from(settlement).where(eq(settlement.key, key));
        if (old) {
          const rows = await tx
            .select({ id: paymentOrder.id })
            .from(paymentOrder)
            .where(eq(paymentOrder.settlementId, old.id))
            .orderBy(paymentOrder.id);
          if (
            old.merchantId !== input.merchantId ||
            old.amountSat !== input.amountSat ||
            old.proof !== input.proof ||
            JSON.stringify(rows.map((r) => r.id)) !== JSON.stringify(ids)
          )
            throw new PaymentFailure({ code: "IDEMPOTENCY_CONFLICT" });
          return { ...old, orderIds: ids };
        }
        const rows = await tx
          .select()
          .from(paymentOrder)
          .where(and(eq(paymentOrder.merchantId, input.merchantId), inArray(paymentOrder.id, ids)))
          .orderBy(paymentOrder.id)
          .for("update");
        assertSettlement(rows, input);
        const [record] = await tx
          .insert(settlement)
          .values({
            id: crypto.randomUUID(),
            key,
            merchantId: input.merchantId,
            amountSat: input.amountSat,
            proof: input.proof,
            createdBy: actor,
          })
          .returning();
        await tx
          .update(paymentOrder)
          .set({ settlementId: record.id })
          .where(inArray(paymentOrder.id, ids));
        return { ...record, orderIds: ids };
      });
    },
    async settlements(merchantId: string | undefined, limit: number, offset: number) {
      return transaction({ admin: true }, async (tx) => {
        const rows = await tx
          .select()
          .from(settlement)
          .where(merchantId ? eq(settlement.merchantId, merchantId) : undefined)
          .orderBy(desc(settlement.createdAt), settlement.id)
          .limit(limit)
          .offset(offset);
        return Promise.all(
          rows.map(async (row) => ({
            ...row,
            orderIds: (
              await tx
                .select({ id: paymentOrder.id })
                .from(paymentOrder)
                .where(eq(paymentOrder.settlementId, row.id))
                .orderBy(paymentOrder.id)
            ).map((r) => r.id),
          })),
        );
      });
    },
  };
}
