import { Context, Schema } from "effect";
import { GatewayPayment, GatewayRequest } from "@btc-lightning-pay/api/payments";
import type { createJobStore } from "./store.ts";
import type { createPhoenixClient } from "./phoenix.ts";

export class GatewayFailure extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
export class Gateway extends Context.Service<Gateway, ReturnType<typeof createGatewayService>>()(
  "gateway/Gateway",
) {}
export function createGatewayService(
  store: ReturnType<typeof createJobStore>,
  phoenix: ReturnType<typeof createPhoenixClient>,
  notify: (value: typeof GatewayPayment.Type) => Promise<void>,
) {
  const active = new Set<string>();
  async function refresh(id: string) {
    const job = store.get(id);
    if (!job) return null;
    if (job.result) {
      const saved = Schema.decodeUnknownSync(GatewayPayment)(JSON.parse(job.result));
      if (saved.paidAt) return saved;
    }
    const value = await phoenix.find(id, job.amount);
    if (value) store.save(value);
    return value;
  }
  async function synchronize(id: string) {
    if (active.has(id)) return;
    active.add(id);
    try {
      const value = await refresh(id);
      if (!value) return;
      await notify(value);
      if (value.paidAt) store.synced(id);
    } finally {
      active.delete(id);
    }
  }
  return {
    async create(input: typeof GatewayRequest.Type) {
      const old = store.get(input.orderId);
      if (old && old.amount !== input.amountSat)
        throw new GatewayFailure(409, "IDEMPOTENCY_CONFLICT");
      if (active.has(input.orderId)) return null;
      active.add(input.orderId);
      try {
        // shortcut: ambiguous creation stays pending for manual review; never repeat a non-idempotent create.
        if (store.claim(input.orderId, input.amountSat))
          await phoenix.create(input.orderId, input.amountSat);
        return await refresh(input.orderId);
      } finally {
        active.delete(input.orderId);
      }
    },
    async received(id: string) {
      store.wake(id);
      await synchronize(id);
    },
    async tick(signal?: AbortSignal) {
      for (const id of store.due()) {
        if (signal?.aborted) break;
        store.defer(id);
        try {
          await synchronize(id);
        } catch {
          console.error(JSON.stringify({ event: "payment_sync_pending", orderId: id }));
        }
      }
    },
  };
}
