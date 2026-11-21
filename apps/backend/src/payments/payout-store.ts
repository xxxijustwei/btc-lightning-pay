import type { WalletPayoutState } from "@btc-lightning-pay/api";
import { settlement, settlementPayout } from "@btc-lightning-pay/db/schema";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { PaymentFailure } from "./errors";
import { lockMerchant, UNCONFIRMED_AFTER_SECONDS } from "./settlements";
import type { Transaction, TransactionRunner } from "./store";

export type PayoutRow = typeof settlementPayout.$inferSelect;
export type NewPayoutRow = Omit<
  typeof settlementPayout.$inferInsert,
  "status" | "createdAt" | "paymentId" | "deliveredOut" | "externalTx" | "notSentReason"
>;
type State = typeof WalletPayoutState.Type;
const ACTIVE = ["submitting", "pending"];

/** Locks the settlement's merchant, then the settlement itself. */
async function lockSettlement(tx: Transaction, id: string) {
  const [initial] = await tx
    .select({ merchantId: settlement.merchantId })
    .from(settlement)
    .where(eq(settlement.id, id));
  if (!initial) throw new PaymentFailure({ code: "SETTLEMENT_NOT_FOUND" });
  await lockMerchant(tx, initial.merchantId);
  const [row] = await tx.select().from(settlement).where(eq(settlement.id, id)).for("update");
  return row;
}
/** A settlement may get a new payout only while pending and while no payout is active. */
async function payable(tx: Transaction, settlementId: string) {
  const row = await lockSettlement(tx, settlementId);
  if (row.status !== "pending") throw new PaymentFailure({ code: "SETTLEMENT_STATE_CONFLICT" });
  const [active] = await tx
    .select({ id: settlementPayout.id })
    .from(settlementPayout)
    .where(
      and(
        eq(settlementPayout.settlementId, settlementId),
        inArray(settlementPayout.status, ACTIVE),
      ),
    )
    .limit(1);
  if (active) throw new PaymentFailure({ code: "PAYOUT_IN_PROGRESS" });
  // A new quote replaces the open one.
  await tx
    .update(settlementPayout)
    .set({ status: "expired" })
    .where(
      and(eq(settlementPayout.settlementId, settlementId), eq(settlementPayout.status, "quoted")),
    );
  return row;
}
export const isUnconfirmed = (row: Pick<PayoutRow, "status" | "submittedAt">, now = Date.now()) =>
  row.status === "submitting" &&
  row.submittedAt !== null &&
  now - row.submittedAt.getTime() >= UNCONFIRMED_AFTER_SECONDS * 1000;

/**
 * Settlement payouts. Every change locks the merchant first, as settlement changes do, so a payout
 * and its settlement always move together.
 */
export function createPayoutStore(transaction: TransactionRunner) {
  async function lockPayout(tx: Transaction, settlementId: string, payoutId: string) {
    const batch = await lockSettlement(tx, settlementId);
    const [payout] = await tx
      .select()
      .from(settlementPayout)
      .where(
        and(eq(settlementPayout.id, payoutId), eq(settlementPayout.settlementId, settlementId)),
      )
      .for("update");
    if (!payout) throw new PaymentFailure({ code: "PAYOUT_NOT_FOUND" });
    return { batch, payout };
  }
  async function update(
    tx: Transaction,
    id: string,
    set: PgUpdateSetSource<typeof settlementPayout>,
  ) {
    const [row] = await tx
      .update(settlementPayout)
      .set(set)
      .where(eq(settlementPayout.id, id))
      .returning();
    return row;
  }
  return {
    /** The settlement a new quote would pay, after expiring its open quote. */
    beginQuote: (settlementId: string) =>
      transaction({ admin: true }, (tx) => payable(tx, settlementId)),
    /** Stores a quote; the settlement is checked again, since the wallet call ran unlocked. */
    insertQuote: (values: NewPayoutRow) =>
      transaction({ admin: true }, async (tx) => {
        const batch = await payable(tx, values.settlementId);
        if (batch.amountSat !== values.amountSat)
          throw new PaymentFailure({ code: "SETTLEMENT_STATE_CONFLICT" });
        const [row] = await tx
          .insert(settlementPayout)
          .values({ ...values, status: "quoted", createdAt: sql`clock_timestamp()` })
          .returning();
        return row;
      }),
    /**
     * Claims a quoted payout for submission. An expired quote is recorded as expired and answered
     * `QUOTE_EXPIRED`, so the claim never reaches the wallet.
     */
    beginSubmit: (settlementId: string, payoutId: string, actor: string) =>
      transaction({ admin: true }, async (tx) => {
        const { batch, payout } = await lockPayout(tx, settlementId, payoutId);
        if (batch.status !== "pending")
          throw new PaymentFailure({ code: "SETTLEMENT_STATE_CONFLICT" });
        if (payout.status !== "quoted") throw new PaymentFailure({ code: "PAYOUT_STATE_CONFLICT" });
        if (payout.quoteExpiresAt.getTime() <= Date.now())
          return { expired: await update(tx, payoutId, { status: "expired" }) };
        return {
          claimed: await update(tx, payoutId, {
            status: "submitting",
            submittedBy: actor,
            submittedAt: sql`clock_timestamp()`,
          }),
        };
      }),
    /** The wallet accepted the submission. */
    recordSent: (payoutId: string, paymentId: string) =>
      transaction({ admin: true }, async (tx) => {
        const [row] = await tx
          .update(settlementPayout)
          .set({ status: "pending", paymentId })
          .where(and(eq(settlementPayout.id, payoutId), eq(settlementPayout.status, "submitting")))
          .returning();
        return row;
      }),
    /** The wallet refused the submission before any funds moved. */
    recordRefused: (payoutId: string, status: "expired" | "failed") =>
      transaction({ admin: true }, async (tx) => {
        const [row] = await tx
          .update(settlementPayout)
          .set({
            status,
            resolvedAt: status === "failed" ? sql`clock_timestamp()` : null,
          })
          .where(and(eq(settlementPayout.id, payoutId), eq(settlementPayout.status, "submitting")))
          .returning();
        return row;
      }),
    /**
     * Applies what the wallet reports for an active payout. A completed payout settles its
     * settlement in the same transaction; a missing payment changes nothing.
     */
    applyState: (row: Pick<PayoutRow, "id" | "settlementId">, state: State) =>
      transaction({ admin: true }, async (tx) => {
        const { payout } = await lockPayout(tx, row.settlementId, row.id);
        if (!ACTIVE.includes(payout.status) || state.state === "missing") return payout;
        const paymentId = state.paymentId ?? payout.paymentId ?? payout.id;
        const resolvedAt = sql`clock_timestamp()`;
        if (state.state === "pending")
          return payout.status === "pending"
            ? payout
            : update(tx, payout.id, { status: "pending", paymentId });
        if (state.state !== "completed")
          return update(tx, payout.id, { status: state.state, paymentId, resolvedAt });
        const deliveredOut = state.deliveredOut ?? payout.estimatedOut;
        const saved = await update(tx, payout.id, {
          status: "completed",
          paymentId,
          deliveredOut,
          externalTx: state.externalTx,
          resolvedAt,
        });
        await tx
          .update(settlement)
          .set({
            status: "settled",
            proof: state.externalTx ?? paymentId,
            confirmedBy: payout.submittedBy,
            confirmedAt: sql`clock_timestamp()`,
          })
          .where(and(eq(settlement.id, payout.settlementId), eq(settlement.status, "pending")));
        return saved;
      }),
    /** An admin's finding that an unconfirmed submission never moved funds. */
    markNotSent: (settlementId: string, payoutId: string, reason: string, actor: string) =>
      transaction({ admin: true }, async (tx) => {
        const { payout } = await lockPayout(tx, settlementId, payoutId);
        const text = reason.trim();
        if (text.length < 1 || text.length > 500)
          throw new PaymentFailure({ code: "INVALID_INPUT" });
        if (!isUnconfirmed(payout)) throw new PaymentFailure({ code: "PAYOUT_STATE_CONFLICT" });
        return update(tx, payoutId, {
          status: "not_sent",
          notSentReason: text,
          resolvedBy: actor,
          resolvedAt: sql`clock_timestamp()`,
        });
      }),
    /** Marks quotes past their expiry; returns how many. */
    expireQuotes: () =>
      transaction({ admin: true }, async (tx) => {
        const rows = await tx
          .update(settlementPayout)
          .set({ status: "expired" })
          .where(
            and(
              eq(settlementPayout.status, "quoted"),
              lte(settlementPayout.quoteExpiresAt, sql`now()`),
            ),
          )
          .returning({ id: settlementPayout.id });
        return rows.length;
      }),
    /** Submitted payouts the wallet has not settled yet, oldest submission first. */
    openPayouts: (limit = 50) =>
      transaction({ admin: true }, (tx) =>
        tx
          .select()
          .from(settlementPayout)
          .where(inArray(settlementPayout.status, ACTIVE))
          .orderBy(asc(settlementPayout.submittedAt))
          .limit(limit),
      ),
    payout: (id: string) =>
      transaction({ admin: true }, async (tx) => {
        const [row] = await tx.select().from(settlementPayout).where(eq(settlementPayout.id, id));
        if (!row) throw new PaymentFailure({ code: "PAYOUT_NOT_FOUND" });
        return row;
      }),
    /** Every payout of a settlement, newest first. */
    payouts: (settlementId: string) =>
      transaction({ admin: true }, (tx) =>
        tx
          .select()
          .from(settlementPayout)
          .where(eq(settlementPayout.settlementId, settlementId))
          .orderBy(desc(settlementPayout.createdAt), desc(settlementPayout.id)),
      ),
  };
}
