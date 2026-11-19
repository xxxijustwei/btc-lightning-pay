import { AdminActor, AdminSession } from "@btc-lightning-pay/api";
import { Context, Effect, Layer, Option } from "effect";
import { Cookies, HttpServerRequest, HttpServerResponse } from "effect/http";
import { parseAuthConfig, type AuthBindings } from "../auth/config";
import { readAdminSession } from "../auth/handler";
import { problem } from "./http";
import { errorFields, type PaymentLog } from "./logging";

/** How admin requests are identified: Better Auth in production, a fixed actor in tests. */
export class AdminSessions extends Context.Service<
  AdminSessions,
  {
    /** The only origin admin writes may come from; absent when auth settings are unusable. */
    readonly origin?: string;
    /**
     * The enabled admin behind the request, or null; `cookies` are refreshed session cookies to
     * send back. "unavailable" means the session lookup itself failed.
     */
    readonly read: (
      headers: Headers,
    ) => Promise<{ actor: string | null; cookies: string[] } | "unavailable">;
    readonly log: PaymentLog;
  }
>()("backend/AdminSessions") {}

/** Admin sessions read through Better Auth on the invocation's database connection. */
export function betterAuthSessions(
  env: AuthBindings,
  database: Parameters<typeof readAdminSession>[1],
  log: PaymentLog,
): typeof AdminSessions.Service {
  let config: ReturnType<typeof parseAuthConfig> | undefined;
  try {
    config = parseAuthConfig(env);
  } catch {
    // Admin requests then answer 503; payer requests are unaffected.
  }
  return {
    origin: config?.url,
    log,
    read: async (headers) => {
      if (!config) return "unavailable";
      try {
        const session = await readAdminSession(config, database, headers);
        return { actor: session.user?.id ?? null, cookies: session.headers.getSetCookie() };
      } catch (error) {
        log({ operation: "read_admin_session", ...errorFields(error) });
        return "unavailable";
      }
    },
  };
}

const unavailable = () =>
  HttpServerResponse.jsonUnsafe(
    { code: "PAYMENTS_UNAVAILABLE", message: "Authentication unavailable" },
    { status: 503, headers: { "cache-control": "no-store" } },
  );

/**
 * The admin group's seam: auth settings, then the origin of writes, then the session and the
 * admin's status. Only a request that passes them all reaches an admin endpoint, as `AdminActor`.
 */
export const AdminSessionLive = Layer.succeed(AdminSession, (endpoint) =>
  Effect.gen(function* () {
    const found = yield* Effect.serviceOption(AdminSessions);
    // The request handler provides AdminSessions with every request; see `PaymentAppServices`.
    if (Option.isNone(found)) return unavailable();
    const sessions = found.value;
    if (!sessions.origin) return unavailable();
    const request = yield* HttpServerRequest.HttpServerRequest;
    // Compared with the normalized origin, so a trailing slash in the setting cannot lock writes out.
    if (!["GET", "HEAD"].includes(request.method) && request.headers.origin !== sessions.origin) {
      sessions.log({ operation: "admin_session", code: "ORIGIN_REJECTED" });
      return problem("ORIGIN_REJECTED");
    }
    const session = yield* Effect.promise(() =>
      sessions.read(new Headers(Object.entries(request.headers))),
    );
    if (session === "unavailable") return unavailable();
    if (!session.actor) return problem("UNAUTHORIZED");
    const response = yield* Effect.provideService(endpoint, AdminActor, { id: session.actor });
    return session.cookies.length
      ? HttpServerResponse.mergeCookies(response, Cookies.fromSetCookie(session.cookies))
      : response;
  }),
);
