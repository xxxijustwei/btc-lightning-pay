import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./schema";

const admin = sql`current_setting('app.payment_admin', true) = 'true'`;
const tenant = (column: SQLWrapper) =>
  sql`${column} = nullif(current_setting('app.merchant_id', true), '')`;
export const merchant = pgTable(
  "merchant",
  {
    id: text("id").primaryKey(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("merchant_id_format", sql`${t.id} ~ '^[a-z][a-z0-9-]{2,31}$'`),
    pgPolicy("merchant_access", {
      for: "all",
      using: sql`${admin} OR ${tenant(t.id)}`,
      withCheck: admin,
    }),
  ],
).enableRLS();

export const settlement = pgTable(
  "settlement",
  {
    id: uuid("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchant.id, { onDelete: "restrict" }),
    key: text("idempotency_key").notNull().unique(),
    amountSat: bigint("amount_sat", { mode: "number" }).notNull(),
    proof: text("proof"),
    status: text("status").notNull(),
    orderCount: integer("order_count").notNull(),
    cutoffAt: timestamp("cutoff_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: text("confirmed_by").references(() => user.id, { onDelete: "restrict" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by").references(() => user.id, { onDelete: "restrict" }),
    cancelReason: text("cancel_reason"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("settlement_tenant_id").on(t.merchantId, t.id),
    index("settlement_confirmer_idx").on(t.confirmedBy),
    index("settlement_canceller_idx").on(t.cancelledBy),
    check("settlement_count", sql`${t.orderCount} > 0`),
    check(
      "settlement_state",
      sql`(${t.status} = 'pending' AND ${t.cutoffAt} IS NOT NULL AND ${t.proof} IS NULL AND ${t.confirmedAt} IS NULL AND ${t.confirmedBy} IS NULL AND ${t.cancelledAt} IS NULL AND ${t.cancelledBy} IS NULL AND ${t.cancelReason} IS NULL) OR (${t.status} = 'settled' AND ${t.proof} IS NOT NULL AND ${t.confirmedAt} IS NOT NULL AND ${t.confirmedBy} IS NOT NULL AND ${t.cancelledAt} IS NULL AND ${t.cancelledBy} IS NULL AND ${t.cancelReason} IS NULL) OR (${t.status} = 'cancelled' AND ${t.cutoffAt} IS NOT NULL AND ${t.proof} IS NULL AND ${t.confirmedAt} IS NULL AND ${t.confirmedBy} IS NULL AND ${t.cancelledAt} IS NOT NULL AND ${t.cancelledBy} IS NOT NULL AND length(trim(${t.cancelReason})) BETWEEN 1 AND 500 AND ${t.cancelReason} IS NOT NULL)`,
    ),
    index("settlement_creator_idx").on(t.createdBy),
    index("settlement_merchant_created_idx").on(t.merchantId, t.createdAt),
    check("settlement_amount", sql`${t.amountSat} > 0 AND ${t.amountSat} <= 2100000000000000`),
    check("settlement_proof", sql`length(${t.proof}) BETWEEN 1 AND 1000`),
    pgPolicy("settlement_access", { for: "all", using: admin, withCheck: admin }),
  ],
).enableRLS();

export const paymentOrder = pgTable(
  "payment_order",
  {
    id: uuid("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchant.id, { onDelete: "restrict" }),
    key: text("idempotency_key").notNull(),
    amountUsdCents: integer("amount_usd_cents").notNull(),
    amountSat: bigint("amount_sat", { mode: "number" }).notNull(),
    reference: text("reference").notNull().default(""),
    rateUsd: text("rate_usd").notNull(),
    quotedAt: timestamp("quoted_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("creating"),
    invoice: text("invoice"),
    paymentHash: text("payment_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    receivedMsat: bigint("received_msat", { mode: "number" }),

    settlementId: uuid("settlement_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("order_tenant_id").on(t.merchantId, t.id),
    index("order_settlement_candidates")
      .on(t.merchantId, t.paidAt, t.id)
      .where(sql`${t.status} = 'paid' AND ${t.settlementId} IS NULL`),
    unique("order_idempotency").on(t.merchantId, t.key),
    uniqueIndex("order_payment_hash").on(t.paymentHash),
    index("order_merchant_created").on(t.merchantId, t.createdAt),
    index("order_created").on(t.createdAt),
    index("order_settlement").on(t.merchantId, t.settlementId),
    index("order_recovery")
      .on(t.attemptedAt, t.id)
      .where(sql`${t.status} IN ('creating','pending')`),
    foreignKey({
      columns: [t.merchantId, t.settlementId],
      foreignColumns: [settlement.merchantId, settlement.id],
      name: "order_settlement_tenant",
    }).onDelete("restrict"),
    check("order_usd", sql`${t.amountUsdCents} BETWEEN 1000 AND 30000`),
    check("order_sats", sql`${t.amountSat} BETWEEN 1 AND 9007199254740`),
    check("order_reference", sql`length(${t.reference}) <= 128`),
    check("order_rate", sql`${t.rateUsd} ~ '^[0-9]+([.][0-9]+)?$' AND ${t.rateUsd}::numeric > 0`),
    check("order_status", sql`${t.status} IN ('creating','pending','paid','expired','failed')`),
    check(
      "order_invoice_consistency",
      sql`(${t.invoice} IS NULL AND ${t.paymentHash} IS NULL AND ${t.expiresAt} IS NULL AND ${t.status} IN ('creating','failed')) OR (${t.invoice} IS NOT NULL AND ${t.paymentHash} IS NOT NULL AND ${t.paymentHash} ~ '^[0-9a-f]{64}$' AND ${t.expiresAt} IS NOT NULL AND ${t.status} IN ('pending','paid','expired'))`,
    ),
    check(
      "order_paid_consistency",
      sql`(${t.status} = 'paid' AND ${t.paidAt} IS NOT NULL AND ${t.paymentHash} IS NOT NULL AND ${t.receivedMsat} IS NOT NULL AND ${t.receivedMsat} > 0 AND ${t.receivedMsat} = ${t.amountSat} * 1000) OR (${t.status} <> 'paid' AND ${t.paidAt} IS NULL AND ${t.receivedMsat} IS NULL)`,
    ),
    check("order_settled_paid", sql`${t.settlementId} IS NULL OR ${t.status} = 'paid'`),
    pgPolicy("order_access", {
      for: "all",
      using: sql`${admin} OR ${tenant(t.merchantId)} OR ${t.id}::text = nullif(current_setting('app.order_id', true), '')`,
      withCheck: sql`${admin} OR ${tenant(t.merchantId)}`,
    }),
  ],
).enableRLS();

export const settlementItem = pgTable(
  "settlement_item",
  {
    settlementId: uuid("settlement_id").notNull(),
    merchantId: text("merchant_id").notNull(),
    orderId: uuid("order_id").notNull(),
    amountSat: bigint("amount_sat", { mode: "number" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.settlementId, t.orderId] }),
    index("settlement_item_order_idx").on(t.merchantId, t.orderId),
    index("settlement_item_batch_idx").on(t.merchantId, t.settlementId),
    foreignKey({
      columns: [t.merchantId, t.settlementId],
      foreignColumns: [settlement.merchantId, settlement.id],
      name: "settlement_item_batch_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.merchantId, t.orderId],
      foreignColumns: [paymentOrder.merchantId, paymentOrder.id],
      name: "settlement_item_order_fk",
    }).onDelete("restrict"),
    check("settlement_item_amount", sql`${t.amountSat} > 0 AND ${t.amountSat} <= 9007199254740`),
    pgPolicy("settlement_item_access", { for: "all", using: admin, withCheck: admin }),
  ],
).enableRLS();
