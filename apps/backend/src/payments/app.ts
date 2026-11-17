import { GatewayPayment, PaymentsApi } from "@btc-lightning-pay/api";
import { Context, Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { adminOrder, createPaymentStore, PaymentFailure, publicOrder } from "./store";

export class PaymentRuntime extends Context.Service<
  PaymentRuntime,
  {
    store: ReturnType<typeof createPaymentStore>;
    actor?: string;
    quote: () => Promise<{ rateUsd: string; quotedAt: Date }>;
    gateway: (id: string, amountSat: number) => Promise<typeof GatewayPayment.Type | null>;
  }
>()("backend/PaymentRuntime") {}

const run = <A>(work: (runtime: typeof PaymentRuntime.Service) => Promise<A>, admin = false) =>
  Effect.gen(function* () {
    const runtime = yield* PaymentRuntime;
    return yield* Effect.tryPromise({
      try: () => {
        if (admin && !runtime.actor) throw new PaymentFailure(403, "ADMIN_REQUIRED");
        return work(runtime);
      },
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) => {
        const known = error instanceof PaymentFailure;
        if (!known) console.error(JSON.stringify({ event: "payments_request_failed" }));
        return Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            {
              code: known ? error.code : "PAYMENTS_UNAVAILABLE",
              message: known ? error.code : "Payment service unavailable",
            },
            { status: known ? error.status : 503 },
          ),
        );
      }),
    );
  });
function paging(query: { limit?: string; offset?: string }) {
  const limit = Number(query.limit ?? 50),
    offset = Number(query.offset ?? 0);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100000
  )
    throw new PaymentFailure(400, "INVALID_PAGINATION");
  return [limit, offset] as const;
}
const PublicLive = HttpApiBuilder.group(PaymentsApi, "publicPayments", (handlers) =>
  handlers.handleAll({
    merchant: ({ params }) =>
      run(async (r) => {
        const m = await r.store.merchant(params.merchantId);
        return {
          merchantId: m.id,
          enabled: m.enabled,
          currency: "USD" as const,
          minAmountUsdCents: 1000 as const,
          maxAmountUsdCents: 30000 as const,
        };
      }),
    createOrder: ({ params, payload, headers }) =>
      run(async (r) => {
        let row = await r.store.createOrder(
          params.merchantId,
          headers["idempotency-key"],
          payload,
          r.quote,
        );
        if (!row.invoice) {
          let result;
          try {
            result = await r.gateway(row.id, row.amountSat);
          } catch {
            return publicOrder(row);
          }
          if (result) row = await r.store.sync(result);
        }
        return publicOrder(row);
      }),
    order: ({ params }) => run(async (r) => publicOrder(await r.store.getOrder(params.orderId))),
  }),
);
const AdminLive = HttpApiBuilder.group(PaymentsApi, "adminPayments", (handlers) =>
  handlers.handleAll({
    createMerchant: ({ payload }) => run((r) => r.store.createMerchant(payload.id), true),
    merchants: ({ query }) => run((r) => r.store.merchants(...paging(query)), true),
    updateMerchant: ({ params, payload }) =>
      run((r) => r.store.updateMerchant(params.merchantId, payload.enabled), true),
    orders: ({ query }) => run((r) => r.store.orders(query, ...paging(query)), true),
    order: ({ params }) =>
      run(async (r) => adminOrder(await r.store.getOrder(params.orderId, true)), true),
    summary: ({ params }) => run((r) => r.store.summary(params.merchantId), true),
    settle: ({ payload, headers }) =>
      run((r) => r.store.settle(headers["idempotency-key"], payload, r.actor!), true),
    settlements: ({ query }) =>
      run((r) => r.store.settlements(query.merchantId, ...paging(query)), true),
  }),
);
export const paymentApp = HttpRouter.toWebHandler(
  HttpApiBuilder.layer(PaymentsApi).pipe(
    Layer.provide([PublicLive, AdminLive]),
    Layer.provide(HttpServer.layerServices),
  ),
);
export function createGatewayClient(url: string, token: string, fetcher: typeof fetch = fetch) {
  const target = new URL(url);
  if (
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash ||
    (target.protocol !== "https:" &&
      !(target.protocol === "http:" && ["127.0.0.1", "localhost"].includes(target.hostname))) ||
    token.length < 32
  )
    throw new Error("Invalid gateway configuration");
  return async (orderId: string, amountSat: number) => {
    const response = await fetcher(`${target.origin}/v1/invoices`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ orderId, amountSat }),
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 202) return null;
    if (!response.ok) throw new Error("Gateway unavailable");
    const result = Schema.decodeUnknownSync(GatewayPayment)(await response.json());
    if (result.orderId !== orderId || result.amountSat !== amountSat)
      throw new Error("Gateway mismatch");
    return result;
  };
}
