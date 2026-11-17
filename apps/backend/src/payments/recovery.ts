import { createDatabase } from "@btc-lightning-pay/db/client";
import { createGatewayClient } from "./app";
import { createPaymentStore } from "./store";
import type { PaymentsBindings } from "./handler";

export async function recoverOrders(env: PaymentsBindings) {
  const url = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  if (!url || !env.GATEWAY_URL || !env.GATEWAY_TOKEN) return;
  const resource = createDatabase(url);
  try {
    const store = createPaymentStore(resource.database);
    const gateway = createGatewayClient(env.GATEWAY_URL, env.GATEWAY_TOKEN);
    for (const row of await store.recoveryBatch()) {
      try {
        const result = await gateway(row.id, row.amountSat);
        if (result) await store.sync(result);
      } catch {
        console.error(JSON.stringify({ event: "order_recovery_pending", orderId: row.id }));
      }
    }
  } finally {
    await resource.close();
  }
}
