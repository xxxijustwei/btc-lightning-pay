import type { Database } from "@btc-lightning-pay/db/client";
import { merchant, paymentOrder, settlement } from "@btc-lightning-pay/db/schema";
import type {
  GatewayPayment,
  NewOrder,
  NewSettlement,
  PaymentStatus,
} from "@btc-lightning-pay/api";
import { and, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { quoteSats } from "./quote";

export class PaymentFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
export type OrderRow = typeof paymentOrder.$inferSelect;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export function publicOrder(row: OrderRow) {
  return {
    id: row.id,
    merchantId: row.merchantId,
    amountUsdCents: row.amountUsdCents,
    amountSat: row.amountSat,
    status: statusOf(row),
    invoice: row.invoice,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    serverTime: new Date().toISOString(),
  };
}
export function adminOrder(row: OrderRow) {
  return {
    ...publicOrder(row),
    reference: row.reference,
    rateUsd: row.rateUsd,
    rateSource: "coinbase" as const,
    quotedAt: row.quotedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    paymentHash: row.paymentHash,
    receivedMsat: row.receivedMsat,
    feeMsat: row.feeMsat,
    settlementId: row.settlementId,
  };
}
function statusOf(row: OrderRow): typeof PaymentStatus.Type {
  if (row.paidAt) return "paid";
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return "expired";
  if (row.invoice) return "pending";
  return row.status === "failed" ? "failed" : "creating";
}
export type Scope = { admin?: boolean; merchantId?: string; orderId?: string };
export function createPaymentStore(db: Database) {
  async function transaction<T>(scope: Scope, body: (tx: Transaction) => Promise<T>) {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.payment_admin', ${scope.admin ? "true" : "false"}, true), set_config('app.merchant_id', ${scope.merchantId ?? ""}, true), set_config('app.order_id', ${scope.orderId ?? ""}, true)`,
      );
      return body(tx);
    });
  }
  async function getOrder(id: string, admin = false) {
    return transaction({ admin, orderId: id }, async (tx) => {
      const [row] = await tx.select().from(paymentOrder).where(eq(paymentOrder.id, id));
      if (!row) throw new PaymentFailure(404, "ORDER_NOT_FOUND");
      return row;
    });
  }
  return {
    getOrder,
    async recoveryBatch() {
      return transaction({ admin: true }, async (tx) => {
        const rows = await tx
          .select()
          .from(paymentOrder)
          .where(eq(paymentOrder.status, "creating"))
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
        if (!row) throw new PaymentFailure(404, "MERCHANT_NOT_FOUND");
        return row;
      });
    },
    async createOrder(
      merchantId: string,
      key: string,
      input: typeof NewOrder.Type,
      quote: () => Promise<{ rateUsd: string; quotedAt: Date }>,
    ) {
      // Serialize a merchant's admission and idempotency checks across Worker instances.
      return transaction({ merchantId }, async (tx) => {
        const [m] = await tx
          .select()
          .from(merchant)
          .where(eq(merchant.id, merchantId))
          .for("update");
        if (!m) throw new PaymentFailure(404, "MERCHANT_NOT_FOUND");
        const [old] = await tx
          .select()
          .from(paymentOrder)
          .where(and(eq(paymentOrder.merchantId, merchantId), eq(paymentOrder.key, key)));
        if (old) {
          if (
            old.amountUsdCents !== input.amountUsdCents ||
            old.reference !== (input.reference ?? "")
          )
            throw new PaymentFailure(409, "IDEMPOTENCY_CONFLICT");
          return old;
        }
        if (!m.enabled) throw new PaymentFailure(409, "MERCHANT_DISABLED");
        const recent = await tx
          .select({ id: paymentOrder.id })
          .from(paymentOrder)
          .where(
            and(
              eq(paymentOrder.merchantId, merchantId),
              gte(paymentOrder.createdAt, new Date(Date.now() - 1000)),
            ),
          )
          .limit(5);
        if (recent.length >= 5) throw new PaymentFailure(429, "RATE_LIMITED");
        let price;
        try {
          price = await quote();
        } catch {
          throw new PaymentFailure(503, "QUOTE_UNAVAILABLE");
        }
        const [row] = await tx
          .insert(paymentOrder)
          .values({
            id: crypto.randomUUID(),
            merchantId,
            key,
            amountUsdCents: input.amountUsdCents,
            amountSat: quoteSats(input.amountUsdCents, price.rateUsd),
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
        if (!row) throw new PaymentFailure(404, "ORDER_NOT_FOUND");
        const expiry = new Date(payment.expiresAt);
        const paidAt = payment.paidAt ? new Date(payment.paidAt) : null;
        if (
          row.amountSat !== payment.amountSat ||
          (row.paymentHash && row.paymentHash !== payment.paymentHash) ||
          (row.invoice && row.invoice !== payment.invoice) ||
          !Number.isFinite(expiry.getTime()) ||
          (paidAt && !Number.isFinite(paidAt.getTime()))
        )
          throw new PaymentFailure(409, "PAYMENT_MISMATCH");
        if (row.paidAt) {
          if (
            payment.paidAt &&
            (row.receivedMsat !== payment.receivedMsat || row.feeMsat !== payment.feeMsat)
          )
            throw new PaymentFailure(409, "PAYMENT_MISMATCH");
          return row;
        }
        if (
          paidAt &&
          (payment.receivedMsat === null ||
            payment.receivedMsat <= 0 ||
            payment.feeMsat === null ||
            payment.receivedMsat + payment.feeMsat !== row.amountSat * 1000)
        )
          throw new PaymentFailure(409, "PAYMENT_MISMATCH");
        if (!paidAt && (payment.receivedMsat !== null || payment.feeMsat !== null))
          throw new PaymentFailure(409, "PAYMENT_MISMATCH");
        const [updated] = await tx
          .update(paymentOrder)
          .set({
            invoice: payment.invoice,
            paymentHash: payment.paymentHash,
            expiresAt: expiry,
            paidAt,
            receivedMsat: payment.receivedMsat,
            feeMsat: payment.feeMsat,
            status: paidAt ? "paid" : "pending",
          })
          .where(eq(paymentOrder.id, row.id))
          .returning();
        return updated;
      });
    },
    async createMerchant(id: string) {
      return transaction({ admin: true }, async (tx) => {
        const [row] = await tx.insert(merchant).values({ id }).onConflictDoNothing().returning();
        if (!row) throw new PaymentFailure(409, "MERCHANT_EXISTS");
        return { ...row, createdAt: row.createdAt.toISOString() };
      });
    },
    async merchants(limit: number, offset: number) {
      return transaction({ admin: true }, async (tx) =>
        (await tx.select().from(merchant).orderBy(merchant.id).limit(limit).offset(offset)).map(
          (row) => ({ ...row, createdAt: row.createdAt.toISOString() }),
        ),
      );
    },
    async updateMerchant(id: string, enabled: boolean) {
      return transaction({ admin: true }, async (tx) => {
        const [row] = await tx
          .update(merchant)
          .set({ enabled })
          .where(eq(merchant.id, id))
          .returning();
        if (!row) throw new PaymentFailure(404, "MERCHANT_NOT_FOUND");
        return { ...row, createdAt: row.createdAt.toISOString() };
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
          if (!Number.isFinite(date.getTime())) throw new PaymentFailure(400, "INVALID_DATE");
          conditions.push(compare(paymentOrder.createdAt, date));
        }
      if (query.status)
        conditions.push(
          sql`CASE WHEN ${paymentOrder.paidAt} IS NOT NULL THEN 'paid' WHEN ${paymentOrder.expiresAt} <= now() THEN 'expired' ELSE ${paymentOrder.status} END = ${query.status}`,
        );
      return transaction({ admin: true }, async (tx) =>
        (
          await tx
            .select()
            .from(paymentOrder)
            .where(and(...conditions))
            .orderBy(desc(paymentOrder.createdAt), paymentOrder.id)
            .limit(limit)
            .offset(offset)
        ).map(adminOrder),
      );
    },
    async summary(merchantId: string) {
      return transaction({ admin: true }, async (tx) => {
        const [m] = await tx.select().from(merchant).where(eq(merchant.id, merchantId));
        if (!m) throw new PaymentFailure(404, "MERCHANT_NOT_FOUND");
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
          throw new PaymentFailure(503, "AMOUNT_OVERFLOW");
        return { merchantId, paidSat, settledSat, unsettledSat: paidSat - settledSat };
      });
    },
    async settle(key: string, input: typeof NewSettlement.Type, actor: string) {
      const ids = [...input.orderIds].sort();
      if (new Set(ids).size !== ids.length) throw new PaymentFailure(400, "DUPLICATE_ORDER");
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
            throw new PaymentFailure(409, "IDEMPOTENCY_CONFLICT");
          return { ...old, orderIds: ids, createdAt: old.createdAt.toISOString() };
        }
        const rows = await tx
          .select()
          .from(paymentOrder)
          .where(and(eq(paymentOrder.merchantId, input.merchantId), inArray(paymentOrder.id, ids)))
          .orderBy(paymentOrder.id)
          .for("update");
        if (
          rows.length !== ids.length ||
          rows.some((r) => !r.paidAt || r.settlementId) ||
          rows.reduce((s, r) => s + BigInt(r.amountSat), 0n) !== BigInt(input.amountSat)
        )
          throw new PaymentFailure(409, "SETTLEMENT_CONFLICT");
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
        return { ...record, orderIds: ids, createdAt: record.createdAt.toISOString() };
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
            createdAt: row.createdAt.toISOString(),
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
