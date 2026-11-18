import { createDatabase } from "@btc-lightning-pay/db/client";
import { createWalletClient } from "./wallet-client";
import { createPaymentStore } from "./store";
import type { PaymentsBindings } from "./handler";
import { Effect } from "effect";
import { createPaymentService } from "./service";
import { createQuoteSource } from "./quote";
import { errorFields, paymentLogger } from "./logging";
import { paymentTask } from "./runtime";

export async function recoverOrders(env: PaymentsBindings) {
  const url = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  if (!url || !env.WALLET_URL || !env.WALLET_TOKEN) return;
  const resource = createDatabase(url);
  const requestId = crypto.randomUUID();
  const log = paymentLogger(requestId);
  try {
    const store = createPaymentStore(resource.database);
    const wallet = createWalletClient(env.WALLET_URL, env.WALLET_TOKEN, fetch, requestId);
    const payments = createPaymentService(store, createQuoteSource(), wallet, log);
    const rows = await Effect.runPromise(
      paymentTask("recovery_batch", () => store.recoveryBatch()),
    );
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(10, rows.length) }, async () => {
        while (next < rows.length) {
          const row = rows[next++];
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
      }),
    );
  } finally {
    await resource.close();
  }
}
