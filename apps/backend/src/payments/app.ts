import { PaymentsApi } from "@btc-lightning-pay/api";
import { Context, Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import type { createPaymentStore } from "./store";
import { adminOrder, publicOrder, settlementView } from "./projection";
import { PaymentFailure, type PaymentError } from "./errors";
import { createPaymentService } from "./service";
import { paymentTask } from "./runtime";
import { errorFields, type PaymentLog } from "./logging";
import { errorBoundary, problem } from "./http";

export class PaymentRuntime extends Context.Service<
  PaymentRuntime,
  {
    store: ReturnType<typeof createPaymentStore>;
    actor?: string;
    payments: ReturnType<typeof createPaymentService>;
    log: PaymentLog;
  }
>()("backend/PaymentRuntime") {}

const run = <A>(
  operation: string,
  work: (runtime: typeof PaymentRuntime.Service) => Effect.Effect<A, PaymentError>,
  admin = false,
) =>
  Effect.gen(function* () {
    const runtime = yield* PaymentRuntime;
    if (admin && !runtime.actor) return problem("ADMIN_REQUIRED");
    const started = Date.now();
    return yield* work(runtime).pipe(
      Effect.catch((error) => {
        runtime.log({ operation, durationMs: Date.now() - started, ...errorFields(error) });
        return Effect.succeed(
          problem(error instanceof PaymentFailure ? error.code : "PAYMENTS_UNAVAILABLE"),
        );
      }),
    );
  });
const read = <A>(
  operation: string,
  work: (runtime: typeof PaymentRuntime.Service) => Promise<A>,
  admin = false,
) => run(operation, (runtime) => paymentTask(operation, () => work(runtime)), admin);
const dated = <A extends { createdAt: Date }>(row: A) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
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
    throw new PaymentFailure({ code: "INVALID_PAGINATION" });
  return [limit, offset] as const;
}
const PublicLive = HttpApiBuilder.group(PaymentsApi, "publicPayments", (handlers) =>
  handlers.handleAll({
    merchant: ({ params }) =>
      read("read_merchant", async (r) => {
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
      run("create_order", (r) =>
        r.payments
          .createOrder(params.merchantId, headers["idempotency-key"], payload)
          .pipe(Effect.map(publicOrder)),
      ),
    order: ({ params }) =>
      run("read_order", (r) => r.payments.order(params.orderId).pipe(Effect.map(publicOrder))),
  }),
);
const AdminLive = HttpApiBuilder.group(PaymentsApi, "adminPayments", (handlers) =>
  handlers.handleAll({
    createMerchant: ({ payload }) =>
      read("create_merchant", async (r) => dated(await r.store.createMerchant(payload.id)), true),
    merchants: ({ query }) =>
      read(
        "list_merchants",
        async (r) => (await r.store.merchants(...paging(query))).map(dated),
        true,
      ),
    updateMerchant: ({ params, payload }) =>
      read(
        "update_merchant",
        async (r) => dated(await r.store.updateMerchant(params.merchantId, payload.enabled)),
        true,
      ),
    orders: ({ query }) =>
      read(
        "list_orders",
        async (r) => (await r.store.orders(query, ...paging(query))).map(adminOrder),
        true,
      ),
    order: ({ params }) =>
      read(
        "read_admin_order",
        async (r) => adminOrder(await r.store.getOrder(params.orderId, true)),
        true,
      ),
    summary: ({ params }) =>
      read("merchant_summary", (r) => r.store.summary(params.merchantId), true),
    settle: ({ payload, headers }) =>
      run(
        "settle_orders",
        (r) =>
          r.payments.settle(headers["idempotency-key"], payload, r.actor!).pipe(
            Effect.map((result) =>
              HttpServerResponse.jsonUnsafe(settlementView(result.record), {
                status: result.created ? 201 : 200,
              }),
            ),
          ),
        true,
      ),
    settlement: ({ params }) =>
      read(
        "read_settlement",
        async (r) => settlementView(await r.store.settlement(params.orderId)),
        true,
      ),
    settlementOrders: ({ params, query }) =>
      read(
        "settlement_orders",
        (r) => r.store.settlementOrders(params.orderId, ...paging(query)),
        true,
      ),
    confirmSettlement: ({ params, payload }) =>
      read(
        "confirm_settlement",
        async (r) =>
          settlementView(await r.store.confirmSettlement(params.orderId, payload.proof, r.actor!)),
        true,
      ),
    cancelSettlement: ({ params, payload }) =>
      read(
        "cancel_settlement",
        async (r) =>
          settlementView(await r.store.cancelSettlement(params.orderId, payload.reason, r.actor!)),
        true,
      ),
    settlements: ({ query }) =>
      read(
        "list_settlements",
        async (r) => {
          const page = await r.store.settlements(query, ...paging(query));
          return { ...page, items: page.items.map(settlementView) };
        },
        true,
      ),
  }),
);
export const paymentApp = HttpRouter.toWebHandler(
  HttpApiBuilder.layer(PaymentsApi).pipe(
    Layer.provide([PublicLive, AdminLive]),
    Layer.provide(HttpServer.layerServices),
    Layer.provide(errorBoundary),
  ),
  { disableLogger: true },
);
