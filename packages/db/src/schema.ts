import { sql } from "drizzle-orm";
export {
  btcQuote,
  merchant,
  paymentOrder,
  settlement,
  settlementItem,
  settlementPayout,
  walletSyncCursor,
} from "./payments";
import {
  bigint,
  boolean,
  integer,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  jsonb,
  pgPolicy,
} from "drizzle-orm/pg-core";

const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    role: text("role", { enum: ["admin", "merchant"] })
      .notNull()
      .default("merchant"),
    banned: boolean("banned").notNull().default(false),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check("user_email_normalized", sql`${t.email} = lower(trim(${t.email}))`),
    check("user_role", sql`${t.role} IN ('admin', 'merchant')`),
  ],
).enableRLS();
export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    impersonatedBy: text("impersonated_by"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
).enableRLS();
export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps(),
  },
  (t) => [
    index("account_user_idx").on(t.userId),
    uniqueIndex("account_provider_identity_idx").on(t.providerId, t.accountId),
  ],
).enableRLS();
export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
).enableRLS();

export const adminAudit = pgTable(
  "admin_audit",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    details: jsonb("details").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("admin_audit_actor_idx").on(t.actorId),
    index("admin_audit_user_idx").on(t.userId),
    pgPolicy("admin_audit_access", {
      for: "all",
      using: sql`current_setting('app.payment_admin', true) = 'true'`,
      withCheck: sql`current_setting('app.payment_admin', true) = 'true'`,
    }),
  ],
).enableRLS();

/** Better Auth's per-IP request counters (`rateLimit.storage: "database"`). */
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
}).enableRLS();

/** Fixed one-hour window of sign-in codes requested per email address. */
export const otpThrottle = pgTable(
  "otp_throttle",
  {
    email: text("email").primaryKey(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    count: integer("count").notNull(),
  },
  (t) => [index("otp_throttle_window_idx").on(t.windowStartedAt)],
).enableRLS();
