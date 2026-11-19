import { adminAudit, merchant, session, user } from "@btc-lightning-pay/db/schema";
import type { NewAdmin, NewMerchant, MerchantUpdate } from "@btc-lightning-pay/api";
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import type { Transaction, TransactionRunner } from "./store";
import { PaymentFailure } from "./errors";

const merchantFields = { ...getTableColumns(merchant), email: user.email };
const userFields = {
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  banned: user.banned,
  createdAt: user.createdAt,
  merchantId: merchant.id,
};
export function createAdministrationStore(transaction: TransactionRunner) {
  const readMerchant = async (tx: Transaction, id: string) => {
    const [row] = await tx
      .select(merchantFields)
      .from(merchant)
      .innerJoin(user, eq(user.id, merchant.userId))
      .where(eq(merchant.id, id));
    if (!row) throw new PaymentFailure({ code: "MERCHANT_NOT_FOUND" });
    return row;
  };
  const readUser = async (tx: Transaction, id: string) => {
    const [row] = await tx
      .select(userFields)
      .from(user)
      .leftJoin(merchant, eq(merchant.userId, user.id))
      .where(eq(user.id, id));
    if (!row) throw new PaymentFailure({ code: "USER_NOT_FOUND" });
    return row;
  };
  const audit = (
    tx: Transaction,
    actorId: string,
    userId: string,
    action: string,
    details: unknown,
  ) => tx.insert(adminAudit).values({ id: crypto.randomUUID(), actorId, userId, action, details });
  const write = <T>(actor: string, body: (tx: Transaction) => Promise<T>) =>
    transaction({ admin: true }, async (tx) => {
      // Serialize low-volume account administration, including the last-admin check.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(1380994389)`);
      const [admin] = await tx.select().from(user).where(eq(user.id, actor));
      if (!admin || admin.role !== "admin" || admin.banned)
        throw new PaymentFailure({ code: "ADMIN_REQUIRED" });
      return body(tx);
    });
  async function provision(
    tx: Transaction,
    input: typeof NewAdmin.Type,
    role: "admin" | "merchant",
  ) {
    const [created] = await tx
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        role,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) throw new PaymentFailure({ code: "EMAIL_EXISTS" });
    return created;
  }
  async function setBanned(tx: Transaction, id: string, banned: boolean) {
    const current = await readUser(tx, id);
    if (banned && current.role === "admin" && !current.banned) {
      const active = await tx
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.role, "admin"), eq(user.banned, false)))
        .limit(2);
      if (active.length < 2) throw new PaymentFailure({ code: "LAST_ADMIN" });
    }
    // The merchant row lock also serializes invoice admission with disabling.
    await tx.update(merchant).set({ enabled: !banned }).where(eq(merchant.userId, id));
    await tx
      .update(user)
      .set({ banned, banReason: banned ? "Disabled by platform" : null, banExpires: null })
      .where(eq(user.id, id));
    if (banned) await tx.delete(session).where(eq(session.userId, id));
    return readUser(tx, id);
  }
  return {
    adminMerchant: (id: string) => transaction({ admin: true }, (tx) => readMerchant(tx, id)),
    managedUser: (id: string) => transaction({ admin: true }, (tx) => readUser(tx, id)),
    users: (role: "admin" | "merchant" | undefined, limit: number, offset: number) =>
      transaction({ admin: true }, (tx) =>
        tx
          .select(userFields)
          .from(user)
          .leftJoin(merchant, eq(merchant.userId, user.id))
          .where(role ? eq(user.role, role) : undefined)
          .orderBy(user.createdAt, user.id)
          .limit(limit)
          .offset(offset),
      ),
    merchants: (limit: number, offset: number) =>
      transaction({ admin: true }, (tx) =>
        tx
          .select(merchantFields)
          .from(merchant)
          .innerJoin(user, eq(user.id, merchant.userId))
          .orderBy(merchant.createdAt, merchant.id)
          .limit(limit)
          .offset(offset),
      ),
    createAdmin: (input: typeof NewAdmin.Type, actor: string) =>
      write(actor, async (tx) => {
        const created = await provision(tx, input, "admin");
        await audit(tx, actor, created.id, "admin.created", {});
        return readUser(tx, created.id);
      }),
    createMerchant: (input: typeof NewMerchant.Type, actor: string) =>
      write(actor, async (tx) => {
        const created = await provision(tx, input, "merchant");
        const [row] = await tx
          .insert(merchant)
          .values({
            id: crypto.randomUUID(),
            userId: created.id,
            name: created.name,
            slug: input.slug,
          })
          .onConflictDoNothing()
          .returning();
        if (!row) throw new PaymentFailure({ code: "MERCHANT_EXISTS" });
        await audit(tx, actor, created.id, "merchant.created", {
          merchantId: row.id,
          slug: row.slug,
        });
        return readMerchant(tx, row.id);
      }),
    /** Admin accounts only: a merchant's account follows its merchant, changed via updateMerchant. */
    updateUser: (id: string, banned: boolean, actor: string) =>
      write(actor, async (tx) => {
        if ((await readUser(tx, id)).role === "merchant")
          throw new PaymentFailure({ code: "USER_IS_MERCHANT" });
        const result = await setBanned(tx, id, banned);
        await audit(tx, actor, id, banned ? "user.disabled" : "user.enabled", {});
        return result;
      }),
    updateMerchant: (id: string, input: typeof MerchantUpdate.Type, actor: string) =>
      write(actor, async (tx) => {
        const old = await readMerchant(tx, id);
        if (input.enabled !== undefined) await setBanned(tx, old.userId, !input.enabled);
        // The merchant and its one-to-one account share a display name.
        if (input.name !== undefined) {
          await tx.update(merchant).set({ name: input.name.trim() }).where(eq(merchant.id, id));
          await tx.update(user).set({ name: input.name.trim() }).where(eq(user.id, old.userId));
        }
        await audit(tx, actor, old.userId, "merchant.updated", {
          before: { name: old.name, enabled: old.enabled },
          after: input,
        });
        return readMerchant(tx, id);
      }),
  };
}
