import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
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
    proof: text("proof").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("settlement_tenant_id").on(t.merchantId, t.id),
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
    feeMsat: bigint("fee_msat", { mode: "number" }),
    settlementId: uuid("settlement_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("order_idempotency").on(t.merchantId, t.key),
    uniqueIndex("order_payment_hash").on(t.paymentHash),
    index("order_merchant_created").on(t.merchantId, t.createdAt),
    index("order_created").on(t.createdAt),
    index("order_settlement").on(t.merchantId, t.settlementId),
    index("order_recovery")
      .on(t.attemptedAt, t.id)
      .where(sql`${t.status} = 'creating'`),
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
      sql`(${t.status} = 'paid' AND ${t.paidAt} IS NOT NULL AND ${t.paymentHash} IS NOT NULL AND ${t.receivedMsat} IS NOT NULL AND ${t.feeMsat} IS NOT NULL AND ${t.receivedMsat} > 0 AND ${t.feeMsat} >= 0 AND ${t.receivedMsat} + ${t.feeMsat} = ${t.amountSat} * 1000) OR (${t.status} <> 'paid' AND ${t.paidAt} IS NULL AND ${t.receivedMsat} IS NULL AND ${t.feeMsat} IS NULL)`,
    ),
    check("order_settled_paid", sql`${t.settlementId} IS NULL OR ${t.status} = 'paid'`),
    pgPolicy("order_access", {
      for: "all",
      using: sql`${admin} OR ${tenant(t.merchantId)} OR ${t.id}::text = nullif(current_setting('app.order_id', true), '')`,
      withCheck: sql`${admin} OR ${tenant(t.merchantId)}`,
    }),
  ],
).enableRLS();
