import { createDatabase } from "@btc-lightning-pay/db/client";
import { paymentErrorStatus } from "@btc-lightning-pay/api";
import { Context } from "effect";
import { parseAuthConfig, type AuthBindings } from "../auth/config";
import { readAdminSession } from "../auth/handler";
import { paymentApp, PaymentRuntime } from "./app";
import { createWalletClient, parseWalletConfig, type WalletBindings } from "./wallet-client";
import { createPaymentService } from "./service";
import { errorFields, paymentLogger } from "./logging";
import { PaymentFailure } from "./errors";
import { createPaymentStore } from "./store";
import { createQuoteSource } from "./quote";

type RateLimiter = { limit(options: { key: string }): Promise<{ success: boolean }> };
export type PaymentsBindings = AuthBindings &
  WalletBindings & {
    /** Payer order creation per IP and merchant (wrangler.jsonc `ratelimits`). */
    ORDER_RATE_LIMITER?: RateLimiter;
    /** Payer reads per IP. */
    PUBLIC_RATE_LIMITER?: RateLimiter;
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
/**
 * Edge limits for the unauthenticated payer API, keyed by client IP (the pay app forwards it).
 * They are per-location approximations; database admission is the exact bound on invoicing.
 */
async function admitPublic(request: Request, path: string, env: PaymentsBindings) {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const creating =
    request.method === "POST" && /^\/api\/public\/merchants\/[^/]+\/orders$/.test(path);
  const limiter = creating ? env.ORDER_RATE_LIMITER : env.PUBLIC_RATE_LIMITER;
  const key = creating ? `${ip}:${path.split("/")[4]}` : ip;
  if (limiter && !(await limiter.limit({ key })).success)
    throw new PaymentFailure({ code: "RATE_LIMITED" });
  return creating;
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
    const admin = path.startsWith("/api/admin/");
    let authConfig: ReturnType<typeof parseAuthConfig> | undefined;
    if (admin) {
      try {
        authConfig = parseAuthConfig(env);
      } catch {
        return json({ code: "PAYMENTS_UNAVAILABLE", message: "Authentication unavailable" }, 503);
      }
      // Compared with the normalized origin, so a trailing slash in the setting cannot lock writes out.
      if (
        !["GET", "HEAD"].includes(original.method) &&
        original.headers.get("origin") !== authConfig.url
      )
        throw new PaymentFailure({ code: "ORIGIN_REJECTED" });
    } else if (await admitPublic(original, path, env)) {
      // Fail fast before touching the database when invoices cannot be issued at all.
      parseWalletConfig(env);
    }
    const databaseUrl = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
    if (!databaseUrl) throw new PaymentFailure({ code: "PAYMENTS_NOT_CONFIGURED" });
    // One connection serves the whole request, the admin session check included.
    resource = createDatabase(databaseUrl);
    let actor: string | undefined;
    let refreshedCookies: string[] = [];
    if (authConfig) {
      let session;
      try {
        session = await readAdminSession(authConfig, resource.database, original.headers);
      } catch (error) {
        log({ operation: "read_admin_session", ...errorFields(error) });
        return json({ code: "PAYMENTS_UNAVAILABLE", message: "Authentication unavailable" }, 503);
      }
      refreshedCookies = session.headers.getSetCookie();
      if (!session.user) return json({ code: "UNAUTHORIZED", message: "UNAUTHORIZED" }, 401);
      actor = session.user.id;
    }
    const requestHeaders = new Headers(original.headers);
    requestHeaders.set("x-request-id", requestId);
    const request = await bounded(new Request(original, { headers: requestHeaders }));
    const store = createPaymentStore(resource.database, original.signal);
    const payments = createPaymentService(
      store,
      quote,
      // Reads tolerate a missing wallet setting: they keep the stored state and log it.
      (id, amount, signal, paymentHash, invoice) =>
        createWalletClient(parseWalletConfig(env), fetch, requestId)(
          id,
          amount,
          signal,
          paymentHash,
          invoice,
        ),
      log,
    );
    const response = await paymentApp.handler(
      request,
      Context.make(PaymentRuntime, { store, actor, payments, log }),
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
