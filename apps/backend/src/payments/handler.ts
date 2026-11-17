import { createDatabase } from "@btc-lightning-pay/db/client";
import { AuthUser, GatewayPayment } from "@btc-lightning-pay/api";
import { Context, Schema } from "effect";
import { timingSafeEqual } from "node:crypto";
import { type AuthBindings } from "../auth/config";
import { handleAuth } from "../auth/handler";
import { createGatewayClient, paymentApp, PaymentRuntime } from "./app";
import { createPaymentStore, PaymentFailure } from "./store";
import { createQuoteSource } from "./quote";

export type PaymentsBindings = AuthBindings & {
  PAYMENTS_ADMIN_IDS?: string;
  GATEWAY_URL?: string;
  GATEWAY_TOKEN?: string;
  WORKER_SYNC_TOKEN?: string;
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
        throw new PaymentFailure(400, "BODY_TOO_LARGE");
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
  let resource: ReturnType<typeof createDatabase> | undefined;
  try {
    const path = new URL(original.url).pathname;
    let actor: string | undefined;
    let refreshedCookies: string[] = [];
    const internal = path === "/api/internal/payments/sync";
    if (internal) {
      if (original.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
      const secret = env.WORKER_SYNC_TOKEN;
      if (!secret || secret.length < 32) throw new PaymentFailure(503, "SYNC_NOT_CONFIGURED");
      const actual = Buffer.from(original.headers.get("authorization") ?? ""),
        expected = Buffer.from(`Bearer ${secret}`);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        throw new PaymentFailure(401, "UNAUTHORIZED");
    } else if (path.startsWith("/api/admin/")) {
      if (
        !["GET", "HEAD"].includes(original.method) &&
        original.headers.get("origin") !== env.BETTER_AUTH_URL
      )
        throw new PaymentFailure(403, "ORIGIN_REJECTED");
      const session = await handleAuth(
        new Request(new URL("/api/me", original.url), { headers: original.headers }),
        env,
      );
      if (!session.ok) return session;
      const user = Schema.decodeUnknownSync(AuthUser)(await session.json());
      refreshedCookies = session.headers.getSetCookie();
      if (
        !(env.PAYMENTS_ADMIN_IDS ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .includes(user.id)
      )
        throw new PaymentFailure(403, "ADMIN_REQUIRED");
      actor = user.id;
    }
    const request = await bounded(original);
    if (
      path.startsWith("/api/public/merchants/") &&
      path.endsWith("/orders") &&
      request.method === "POST"
    ) {
      if (!env.GATEWAY_URL || !env.GATEWAY_TOKEN)
        throw new PaymentFailure(503, "GATEWAY_NOT_CONFIGURED");
      createGatewayClient(env.GATEWAY_URL, env.GATEWAY_TOKEN);
    }
    const databaseUrl = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
    if (!databaseUrl) throw new PaymentFailure(503, "PAYMENTS_NOT_CONFIGURED");
    resource = createDatabase(databaseUrl);
    const store = createPaymentStore(resource.database);
    if (internal) {
      let payload;
      try {
        payload = Schema.decodeUnknownSync(GatewayPayment)(await request.json());
      } catch {
        throw new PaymentFailure(400, "INVALID_INPUT");
      }
      await store.sync(payload);
      return json({ ok: true }, 200);
    }
    const response = await paymentApp.handler(
      request,
      Context.make(PaymentRuntime, {
        store,
        actor,
        quote,
        gateway: async (id, amount) => {
          if (!env.GATEWAY_URL || !env.GATEWAY_TOKEN)
            throw new PaymentFailure(503, "GATEWAY_NOT_CONFIGURED");
          return createGatewayClient(env.GATEWAY_URL, env.GATEWAY_TOKEN)(id, amount);
        },
      }),
    );
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    for (const cookie of refreshedCookies) headers.append("set-cookie", cookie);
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    const known = error instanceof PaymentFailure;
    if (!known) console.error(JSON.stringify({ event: "payments_request_failed" }));
    return json(
      {
        code: known ? error.code : "PAYMENTS_UNAVAILABLE",
        message: known ? error.code : "Payment service unavailable",
      },
      known ? error.status : 503,
    );
  } finally {
    if (resource) {
      try {
        await resource.close();
      } catch {
        console.error(JSON.stringify({ event: "payments_database_close_failed" }));
      }
    }
  }
}
