import { AdminActor, PaymentsApi } from "@btc-lightning-pay/api";
import { Context, Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { adminOrder, publicOrder, settlementView } from "./projection";
import { PaymentFailure, type PaymentError } from "./errors";
import { paymentTask } from "./task";
import { errorFields, type PaymentLog } from "./logging";
import { errorBoundary, problem } from "./http";
import type { Wallet } from "./wallet";
import { Payments, RequestLog } from "../runtime";
import { AdminSessionLive, type AdminSessions } from "./admin-session";

type Runtime = typeof Payments.Service & { log: PaymentLog };

const run = <A>(
  operation: string,
  work: (runtime: Runtime) => Effect.Effect<A, PaymentError, Wallet>,
) =>
  Effect.gen(function* () {
    const runtime: Runtime = { ...(yield* Payments), log: (yield* RequestLog).log };
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
const read = <A>(operation: string, work: (runtime: Runtime) => Promise<A>) =>
  run(operation, (runtime) => paymentTask(operation, () => work(runtime)));
/** Hands an admin endpoint the admin it acts as; only the admin group's middleware provides it. */
const asAdmin = <A, E, R>(work: (actor: string) => Effect.Effect<A, E, R>) =>
  Effect.flatMap(Effect.service(AdminActor), (admin) => work(admin.id));
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
        const m = await r.store.merchantBySlug(params.slug);
        return {
          merchantId: m.id,
          slug: m.slug,
          enabled: m.enabled,
          currency: "USD" as const,
          minAmountUsdCents: 100 as const,
          maxAmountUsdCents: 30000 as const,
        };
      }),
    createOrder: ({ params, payload, headers }) =>
      run("create_order", (r) =>
        r.intake
          .create(params.slug, headers["idempotency-key"], payload)
          .pipe(Effect.map(publicOrder)),
      ),
    order: ({ params }) =>
      run("read_order", (r) => r.payments.order(params.orderId).pipe(Effect.map(publicOrder))),
  }),
);
const AdminLive = HttpApiBuilder.group(PaymentsApi, "adminPayments", (handlers) =>
  handlers.handleAll({
    createAdmin: ({ payload }) =>
      asAdmin((actor) =>
        read("create_admin", async (r) => dated(await r.store.createAdmin(payload, actor))),
      ),
    users: ({ query }) =>
      read("list_users", async (r) =>
        (await r.store.users(query.role, ...paging(query))).map(dated),
      ),
    user: ({ params }) =>
      read("read_user", async (r) => dated(await r.store.managedUser(params.userId))),
    updateUser: ({ params, payload }) =>
      asAdmin((actor) =>
        read("update_user", async (r) =>
          dated(await r.store.updateUser(params.userId, payload.banned, actor)),
        ),
      ),
    merchant: ({ params }) =>
      read("admin_merchant", async (r) => dated(await r.store.adminMerchant(params.merchantId))),
    createMerchant: ({ payload }) =>
      asAdmin((actor) =>
        read("create_merchant", async (r) => dated(await r.store.createMerchant(payload, actor))),
      ),
    merchants: ({ query }) =>
      read("list_merchants", async (r) => (await r.store.merchants(...paging(query))).map(dated)),
    updateMerchant: ({ params, payload }) =>
      asAdmin((actor) =>
        read("update_merchant", async (r) =>
          dated(await r.store.updateMerchant(params.merchantId, payload, actor)),
        ),
      ),
    orders: ({ query }) =>
      read("list_orders", async (r) =>
        (await r.store.orders(query, ...paging(query))).map(adminOrder),
      ),
    // An admin read always asks the wallet, however old the unpaid order is.
    order: ({ params }) =>
      run("read_admin_order", (r) =>
        r.payments.order(params.orderId, true).pipe(Effect.map(adminOrder)),
      ),
    summary: ({ params }) => read("merchant_summary", (r) => r.store.summary(params.merchantId)),
    settle: ({ payload, headers }) =>
      asAdmin((actor) =>
        run("settle_orders", (r) =>
          r.payments.settle(headers["idempotency-key"], payload, actor).pipe(
            Effect.map((result) =>
              HttpServerResponse.jsonUnsafe(settlementView(result.record), {
                status: result.created ? 201 : 200,
              }),
            ),
          ),
        ),
      ),
    settlement: ({ params }) =>
      read("read_settlement", async (r) =>
        settlementView(await r.store.settlement(params.settlementId)),
      ),
    settlementOrders: ({ params, query }) =>
      read("settlement_orders", (r) =>
        r.store.settlementOrders(params.settlementId, ...paging(query)),
      ),
    confirmSettlement: ({ params, payload }) =>
      asAdmin((actor) =>
        read("confirm_settlement", async (r) =>
          settlementView(
            await r.store.confirmSettlement(params.settlementId, payload.proof, actor),
          ),
        ),
      ),
    cancelSettlement: ({ params, payload }) =>
      asAdmin((actor) =>
        read("cancel_settlement", async (r) =>
          settlementView(
            await r.store.cancelSettlement(params.settlementId, payload.reason, actor),
          ),
        ),
      ),
    settlements: ({ query }) =>
      read("list_settlements", async (r) => {
        const page = await r.store.settlements(query, ...paging(query));
        return { ...page, items: page.items.map(settlementView) };
      }),
  }),
);
export const paymentApp = HttpRouter.toWebHandler(
  HttpApiBuilder.layer(PaymentsApi).pipe(
    Layer.provide([PublicLive, AdminLive]),
    Layer.provide(AdminSessionLive),
    Layer.provide(HttpServer.layerServices),
    Layer.provide(errorBoundary),
  ),
  { disableLogger: true },
);
/** What every request brings: the admin middleware reads `AdminSessions` from it. */
export type PaymentAppServices = Payments | RequestLog | Wallet | AdminSessions;
export const handlePaymentApp = (request: Request, context: Context.Context<PaymentAppServices>) =>
  paymentApp.handler(request, context);
