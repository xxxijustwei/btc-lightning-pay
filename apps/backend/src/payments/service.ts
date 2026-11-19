import type { NewSettlement } from "@btc-lightning-pay/api";
import { Effect } from "effect";
import type { Crediting } from "./crediting";
import type { createPaymentStore, OrderRow } from "./store";
import { paymentTask } from "./task";

/**
 * How long after expiry a payer's poll still asks the wallet. Later receipts are found by the
 * payment sync job; admin order reads always ask.
 */
export const PUBLIC_REFRESH_AFTER_EXPIRY_MS = 10 * 60_000;
/** Order reads and settlement; orders are created by Order intake. */
export function createPaymentService(
  store: ReturnType<typeof createPaymentStore>,
  crediting: Crediting,
) {
  /** The order as it stands after asking the wallet; an anomaly leaves it as stored. */
  const refresh = <R extends OrderRow>(row: R) =>
    crediting.check(row).pipe(Effect.map((result) => ("order" in result ? result.order : row)));
  return {
    /** A payer's read stops asking the wallet shortly after expiry; an admin's read always asks. */
    order: Effect.fn("payments.order")(function* (id: string, admin = false) {
      const row = yield* paymentTask("read_order", () => store.getOrder(id, admin));
      if (
        !admin &&
        !row.paidAt &&
        Date.now() > row.expiresAt.getTime() + PUBLIC_REFRESH_AFTER_EXPIRY_MS
      )
        return row;
      return yield* refresh(row);
    }),
    settle: Effect.fn("payments.settle")(function* (
      key: string,
      input: typeof NewSettlement.Type,
      actor: string,
    ) {
      const started = Date.now();
      const result = yield* paymentTask("settle_orders", () => store.settle(key, input, actor));
      yield* Effect.sync(() =>
        console.info(
          JSON.stringify({
            event: "settlement_batch",
            settlementId: result.record.id,
            orderCount: result.record.orderCount,
            created: result.created,
            durationMs: Date.now() - started,
          }),
        ),
      );
      return result;
    }),
  };
}
