import { createDatabase } from "@btc-lightning-pay/db/client";
import { AuthUser, paymentErrorStatus } from "@btc-lightning-pay/api";
import { Context, Schema } from "effect";
import { type AuthBindings } from "../auth/config";
import { handleAuth } from "../auth/handler";
import { paymentApp, PaymentRuntime } from "./app";
import { createGatewayClient } from "./gateway-client";
import { createPaymentService } from "./service";
import { errorFields, paymentLogger } from "./logging";
import { PaymentFailure } from "./errors";
import { createPaymentStore } from "./store";
import { createQuoteSource } from "./quote";

export type PaymentsBindings = AuthBindings & {
  PAYMENTS_ADMIN_IDS?: string;
  GATEWAY_URL?: string;
  GATEWAY_TOKEN?: string;
};
const quote = createQuoteSource();
const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
async function bounded(request: Request) {
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8192) {
        await reader.cancel();
        throw new PaymentFailure({ code: "BODY_TOO_LARGE" });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new Request(request, { method: request.method, body: bytes });
}
export async function handlePayments(original: Request, env: PaymentsBindings): Promise<Response> {
  const requestId = crypto.randomUUID();
  const response = await handleRequest(original, env, requestId);
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  return new Response(response.body, { status: response.status, headers });
}
async function handleRequest(
  original: Request,
  env: PaymentsBindings,
  requestId: string,
): Promise<Response> {
  const log = paymentLogger(requestId);
  const started = Date.now();
  let resource: ReturnType<typeof createDatabase> | undefined;
  try {
    const path = new URL(original.url).pathname;
    let actor: string | undefined;
    let refreshedCookies: string[] = [];
    if (path.startsWith("/api/internal/"))
      return json({ code: "NOT_FOUND", message: "NOT_FOUND" }, 404);
    if (path.startsWith("/api/admin/")) {
      if (
        !["GET", "HEAD"].includes(original.method) &&
        original.headers.get("origin") !== env.BETTER_AUTH_URL
      )
        throw new PaymentFailure({ code: "ORIGIN_REJECTED" });
      const session = await handleAuth(
        new Request(new URL("/api/me", original.url), { headers: original.headers }),
        env,
      );
      if (!session.ok)
        return json(
          {
            code: session.status === 401 ? "UNAUTHORIZED" : "PAYMENTS_UNAVAILABLE",
            message: "Authentication unavailable",
          },
          session.status === 401 ? 401 : 503,
        );
      const user = Schema.decodeUnknownSync(AuthUser)(await session.json());
      refreshedCookies = session.headers.getSetCookie();
      if (
        !(env.PAYMENTS_ADMIN_IDS ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .includes(user.id)
      )
        throw new PaymentFailure({ code: "ADMIN_REQUIRED" });
      actor = user.id;
    }
    const requestHeaders = new Headers(original.headers);
    requestHeaders.set("x-request-id", requestId);
    const request = await bounded(new Request(original, { headers: requestHeaders }));
    if (
      path.startsWith("/api/public/merchants/") &&
      path.endsWith("/orders") &&
      request.method === "POST"
    ) {
      if (!env.GATEWAY_URL || !env.GATEWAY_TOKEN)
        throw new PaymentFailure({ code: "GATEWAY_NOT_CONFIGURED" });
      createGatewayClient(env.GATEWAY_URL, env.GATEWAY_TOKEN);
    }
    const databaseUrl = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
    if (!databaseUrl) throw new PaymentFailure({ code: "PAYMENTS_NOT_CONFIGURED" });
    resource = createDatabase(databaseUrl);
    const store = createPaymentStore(resource.database, original.signal);
    const payments = createPaymentService(
      store,
      quote,
      async (id, amount, signal, paymentHash) => {
        if (!env.GATEWAY_URL || !env.GATEWAY_TOKEN)
          throw new PaymentFailure({ code: "GATEWAY_NOT_CONFIGURED" });
        return createGatewayClient(env.GATEWAY_URL, env.GATEWAY_TOKEN, fetch, requestId)(
          id,
          amount,
          signal,
          paymentHash,
        );
      },
      log,
    );
    const response = await paymentApp.handler(
      request,
      Context.make(PaymentRuntime, {
        store,
        actor,
        payments,
        log,
      }),
    );
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    for (const cookie of refreshedCookies) headers.append("set-cookie", cookie);
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    const known = error instanceof PaymentFailure;
    log({
      operation: "handle_payment_request",
      durationMs: Date.now() - started,
      ...errorFields(error),
    });
    return json(
      {
        code: known ? error.code : "PAYMENTS_UNAVAILABLE",
        message: known ? error.code : "Payment service unavailable",
      },
      known ? paymentErrorStatus[error.code] : 503,
    );
  } finally {
    if (resource) {
      try {
        await resource.close();
      } catch {
        log({ operation: "close_database", code: "STORAGE_FAILURE" });
      }
    }
  }
}
