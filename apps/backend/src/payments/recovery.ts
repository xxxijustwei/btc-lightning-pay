import { createDatabase } from "@btc-lightning-pay/db/client";
import { createGatewayClient } from "./gateway-client";
import { createPaymentStore } from "./store";
import type { PaymentsBindings } from "./handler";
import { Effect } from "effect";
import { createPaymentService } from "./service";
import { createQuoteSource } from "./quote";
import { errorFields, paymentLogger } from "./logging";
import { paymentTask } from "./runtime";

export async function recoverOrders(env: PaymentsBindings) {
  const url = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  if (!url || !env.GATEWAY_URL || !env.GATEWAY_TOKEN) return;
  const resource = createDatabase(url);
  const requestId = crypto.randomUUID();
  const log = paymentLogger(requestId);
  try {
    const store = createPaymentStore(resource.database);
    const gateway = createGatewayClient(env.GATEWAY_URL, env.GATEWAY_TOKEN, fetch, requestId);
    const payments = createPaymentService(store, createQuoteSource(), gateway, log);
    for (const row of await Effect.runPromise(
      paymentTask("recovery_batch", () => store.recoveryBatch()),
    )) {
      const started = Date.now();
      await Effect.runPromise(
        payments.ensureInvoice(row).pipe(
          Effect.catch((error) => {
            log({
              operation: "recover_order",
              orderId: row.id,
              durationMs: Date.now() - started,
              ...errorFields(error),
            });
            return Effect.void;
          }),
        ),
      );
    }
  } finally {
    await resource.close();
  }
}
