import type { NewOrder } from "@btc-lightning-pay/api";
import type { OrderRow } from "./store";
import { PaymentFailure } from "./errors";
export function assertSameOrder(
  row: Pick<OrderRow, "amountUsdCents" | "reference">,
  input: typeof NewOrder.Type,
) {
  if (row.amountUsdCents !== input.amountUsdCents || row.reference !== (input.reference ?? ""))
    throw new PaymentFailure({ code: "IDEMPOTENCY_CONFLICT" });
}
