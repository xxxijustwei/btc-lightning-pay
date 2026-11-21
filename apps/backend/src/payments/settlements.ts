import {
  merchant,
  paymentOrder,
  settlement,
  settlementItem,
  settlementPayout,
} from "@btc-lightning-pay/db/schema";
import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNull,
  lte,
  lt,
  sql,
  type SQL,
} from "drizzle-orm";
import type { TransactionRunner, Transaction } from "./store";
import { PaymentFailure } from "./errors";

/** Serializes every settlement and payout change of one merchant. */
export async function lockMerchant(tx: Transaction, id: string) {
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
  await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${"settlement:merchant:" + id},0))`,
  );
  const [row] = await tx.select({ id: merchant.id }).from(merchant).where(eq(merchant.id, id));
  if (!row) throw new PaymentFailure({ code: "MERCHANT_NOT_FOUND" });
}
/** A submitted payout still unanswered after this long shows as unconfirmed. */
export const UNCONFIRMED_AFTER_SECONDS = 30;
/** `status`, except a pending settlement with an active payout shows it as paying or unconfirmed. */
// Qualified by hand: drizzle may render a selected column unqualified, which the subquery would
// resolve against its own table.
const displayStatus = sql<string>`CASE WHEN "settlement"."status" = 'pending' THEN coalesce((SELECT CASE WHEN p.status = 'submitting' AND p.submitted_at < now() - make_interval(secs => ${UNCONFIRMED_AFTER_SECONDS}) THEN 'unconfirmed' ELSE 'paying' END FROM settlement_payout p WHERE p.settlement_id = "settlement"."id" AND p.status IN ('submitting','pending') LIMIT 1), 'pending') ELSE "settlement"."status" END`;
const withDisplay = { ...getTableColumns(settlement), displayStatus };
export function createSettlementStore(transaction: TransactionRunner) {
  async function get(tx: Transaction, id: string) {
    const [row] = await tx.select(withDisplay).from(settlement).where(eq(settlement.id, id));
    if (!row) throw new PaymentFailure({ code: "SETTLEMENT_NOT_FOUND" });
    return row;
  }
  /** Cancels a pending settlement that no payout is paying; repeating the same reason is a no-op. */
  async function cancel(id: string, value: string, actor: string) {
    return transaction({ admin: true }, async (tx) => {
      const initial = await get(tx, id);
      await lockMerchant(tx, initial.merchantId);
      const [row] = await tx.select().from(settlement).where(eq(settlement.id, id)).for("update");
      const text = value.trim();
      if (text.length < 1 || text.length > 500) throw new PaymentFailure({ code: "INVALID_INPUT" });
      if (row.status === "cancelled") {
        if (row.cancelReason !== text)
          throw new PaymentFailure({ code: "SETTLEMENT_REASON_CONFLICT" });
        return get(tx, id);
      }
      if (row.status !== "pending") throw new PaymentFailure({ code: "SETTLEMENT_STATE_CONFLICT" });
      const [active] = await tx
        .select({ id: settlementPayout.id })
        .from(settlementPayout)
        .where(
          and(
            eq(settlementPayout.settlementId, id),
            inArray(settlementPayout.status, ["submitting", "pending"]),
          ),
        )
        .limit(1);
      if (active) throw new PaymentFailure({ code: "PAYOUT_IN_PROGRESS" });
      // An unsubmitted quote dies with its settlement.
      await tx
        .update(settlementPayout)
        .set({ status: "expired" })
        .where(and(eq(settlementPayout.settlementId, id), eq(settlementPayout.status, "quoted")));
      await tx
        .update(paymentOrder)
        .set({ settlementId: null })
        .where(and(eq(paymentOrder.merchantId, row.merchantId), eq(paymentOrder.settlementId, id)));
      await tx
        .update(settlement)
        .set({
          status: "cancelled",
          cancelReason: text,
          cancelledBy: actor,
          cancelledAt: sql`clock_timestamp()`,
        })
        .where(eq(settlement.id, id));
      return get(tx, id);
    });
  }
  return {
    async settle(key: string, input: { merchantId: string }, actor: string) {
      return transaction({ admin: true }, async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${"settlement:key:" + key},0))`,
        );
        const [old] = await tx.select().from(settlement).where(eq(settlement.key, key));
        if (old) {
          if (old.merchantId !== input.merchantId)
            throw new PaymentFailure({ code: "IDEMPOTENCY_CONFLICT" });
          return { record: await get(tx, old.id), created: false };
        }
        await lockMerchant(tx, input.merchantId);
        const rows = await tx
          .select({
            id: paymentOrder.id,
            amountSat: paymentOrder.amountSat,
            cutoffAt: sql<string>`date_trunc('milliseconds',statement_timestamp())::text`,
          })
          .from(paymentOrder)
          .where(
            and(
              eq(paymentOrder.merchantId, input.merchantId),
              eq(paymentOrder.status, "paid"),
              lte(paymentOrder.paidAt, sql`date_trunc('milliseconds',statement_timestamp())`),
              isNull(paymentOrder.settlementId),
            ),
          )
          .orderBy(paymentOrder.id)
          .for("update");
        if (!rows.length) throw new PaymentFailure({ code: "NO_ELIGIBLE_ORDERS" });
        const sum = rows.reduce((total, row) => total + BigInt(row.amountSat), 0n);
        if (sum > 2100000000000000n) throw new PaymentFailure({ code: "AMOUNT_OVERFLOW" });
        const [record] = await tx
          .insert(settlement)
          .values({
            id: crypto.randomUUID(),
            merchantId: input.merchantId,
            key,
            amountSat: Number(sum),
            orderCount: rows.length,
            status: "pending",
            cutoffAt: new Date(rows[0].cutoffAt),
            createdBy: actor,
            createdAt: sql`clock_timestamp()`,
          })
          .returning();
        const ids = JSON.stringify(rows.map((r) => r.id));
        const assigned = await tx
          .update(paymentOrder)
          .set({ settlementId: record.id })
          .where(
            sql`${paymentOrder.id} IN (SELECT value::uuid FROM jsonb_array_elements_text(${ids}::jsonb))`,
          )
          .returning({ id: paymentOrder.id });
        if (assigned.length !== rows.length)
          throw new Error("Settlement reservation count mismatch");
        await tx.execute(
          sql`INSERT INTO settlement_item(settlement_id,merchant_id,order_id,amount_sat) SELECT ${record.id}::uuid,merchant_id,id,amount_sat FROM payment_order WHERE merchant_id=${input.merchantId} AND settlement_id=${record.id}::uuid`,
        );
        return { record: await get(tx, record.id), created: true };
      });
    },
    cancelSettlement: cancel,
    settlement: (id: string) => transaction({ admin: true }, (tx) => get(tx, id)),
    async settlementOrders(id: string, limit: number, offset: number) {
      return transaction({ admin: true }, async (tx) => {
        const batch = await get(tx, id);
        const items = await tx
          .select({
            orderId: settlementItem.orderId,
            merchantId: settlementItem.merchantId,
            amountSat: settlementItem.amountSat,
          })
          .from(settlementItem)
          .where(eq(settlementItem.settlementId, id))
          .orderBy(settlementItem.orderId)
          .limit(limit)
          .offset(offset);
        return { items, total: batch.orderCount, limit, offset };
      });
    },
    async settlements(
      query: { merchantId?: string; status?: string; from?: string; to?: string },
      limit: number,
      offset: number,
    ) {
      const conditions: SQL[] = [];
      if (query.merchantId) conditions.push(eq(settlement.merchantId, query.merchantId));
      if (query.status) conditions.push(eq(settlement.status, query.status));
      for (const [key, compare] of [
        ["from", gte],
        ["to", lt],
      ] as const)
        if (query[key]) {
          const date = new Date(query[key]);
          if (!Number.isFinite(date.getTime())) throw new PaymentFailure({ code: "INVALID_DATE" });
          conditions.push(compare(settlement.createdAt, date));
        }
      return transaction({ admin: true, repeatableRead: true }, async (tx) => {
        const [{ total }] = await tx
          .select({ total: count() })
          .from(settlement)
          .where(and(...conditions));
        const items = await tx
          .select(withDisplay)
          .from(settlement)
          .where(and(...conditions))
          .orderBy(desc(settlement.createdAt), settlement.id)
          .limit(limit)
          .offset(offset);
        return { items, total, limit, offset };
      });
    },
    async summary(merchantId: string) {
      return transaction({ admin: true }, async (tx) => {
        const [m] = await tx
          .select({ id: merchant.id })
          .from(merchant)
          .where(eq(merchant.id, merchantId));
        if (!m) throw new PaymentFailure({ code: "MERCHANT_NOT_FOUND" });
        const [totals] = await tx
          .select({
            paid: sql<string>`coalesce(sum(case when ${paymentOrder.status}='paid' then ${paymentOrder.amountSat} else 0 end),0)::text`,
            settled: sql<string>`coalesce(sum(case when ${settlement.status}='settled' then ${paymentOrder.amountSat} else 0 end),0)::text`,
            pending: sql<string>`coalesce(sum(case when ${settlement.status}='pending' then ${paymentOrder.amountSat} else 0 end),0)::text`,
            // Invoices that can still be paid; expired ones are not waiting on anything.
            unconfirmed: sql<number>`count(*) filter (where ${paymentOrder.status} = 'pending' and ${paymentOrder.expiresAt} > now())::int`,
          })
          .from(paymentOrder)
          .leftJoin(settlement, eq(paymentOrder.settlementId, settlement.id))
          .where(eq(paymentOrder.merchantId, merchantId));
        const paidSat = Number(totals.paid),
          settledSat = Number(totals.settled),
          pendingSettlementSat = Number(totals.pending);
        if (![paidSat, settledSat, pendingSettlementSat].every(Number.isSafeInteger))
          throw new PaymentFailure({ code: "AMOUNT_OVERFLOW" });
        return {
          merchantId,
          paidSat,
          settledSat,
          unsettledSat: paidSat - settledSat,
          pendingSettlementSat,
          availableSettlementSat: paidSat - settledSat - pendingSettlementSat,
          unconfirmedOrderCount: totals.unconfirmed,
        };
      });
    },
  };
}
