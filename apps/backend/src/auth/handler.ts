import { user as users } from "@btc-lightning-pay/db/schema";
import { eq } from "drizzle-orm";
import { createDatabase } from "@btc-lightning-pay/db/client";
import {
  AuthUser,
  AuthUnauthorized,
  AuthUnavailable,
  GetCurrentUser,
} from "@btc-lightning-pay/api";
import { Effect, Schema } from "effect";
import { createAuth } from "./auth";
import { parseAuthConfig, type AuthBindings, type AuthConfig } from "./config";
import { createOTPSender } from "./email";

const AuthSession = Schema.NullOr(Schema.Struct({ user: AuthUser }));
type Database = ReturnType<typeof createDatabase>["database"];

/**
 * Reads the request's session on an existing connection and accepts it only for an enabled
 * admin. `cookies` carries any refreshed session cookie; `body` is Better Auth's session JSON.
 * Throws when the session lookup itself fails.
 */
export async function readAdminSession(config: AuthConfig, database: Database, headers: Headers) {
  // Reading a session never sends mail.
  const auth = createAuth(config, database, async () => {});
  const response = await auth.api.getSession({ headers, asResponse: true });
  if (!response.ok) throw new Error("Session lookup failed");
  const body: unknown = await response.json();
  const session = Schema.decodeUnknownSync(AuthSession)(body);
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-length");
  const [current] = session
    ? await database.select().from(users).where(eq(users.id, session.user.id))
    : [];
  const user =
    session && current?.role === "admin" && !current.banned
      ? Schema.decodeUnknownSync(AuthUser)(session.user)
      : null;
  return { user, body, headers: responseHeaders };
}

const routes: Record<string, string> = {
  [GetCurrentUser.path]: GetCurrentUser.method,
  "/api/auth/email-otp/send-verification-otp": "POST",
  "/api/auth/sign-in/email-otp": "POST",
  "/api/auth/get-session": "GET",
  "/api/auth/sign-out": "POST",
};
export async function handleAuth(request: Request, env: AuthBindings): Promise<Response> {
  const path = new URL(request.url).pathname;
  const method = routes[path];
  if (!method) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
  if (request.method !== method)
    return new Response(null, { status: 405, headers: { allow: method } });
  let config;
  try {
    config = parseAuthConfig(env);
  } catch {
    return Response.json(
      {
        code: "AUTH_NOT_CONFIGURED",
        message: "登录服务尚未配置完成。",
      } satisfies typeof AuthUnavailable.Type,
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  const operation = Effect.scoped(
    Effect.gen(function* () {
      const resource = yield* Effect.acquireRelease(
        Effect.sync(() => createDatabase(config.databaseUrl)),
        (resource) =>
          Effect.tryPromise(() => resource.close()).pipe(
            Effect.catch(() =>
              Effect.sync(() => {
                console.error(JSON.stringify({ event: "database_close_failed" }));
              }),
            ),
          ),
      );
      const sendOTP = createOTPSender(config);
      let deliveryFailed = false;
      const auth = createAuth(config, resource.database, async (message) => {
        try {
          await sendOTP(message);
        } catch {
          // Better Auth suppresses delivery errors; retain the failure within this request.
          deliveryFailed = true;
        }
      });
      if (path === GetCurrentUser.path || path === "/api/auth/get-session") {
        const session = yield* Effect.tryPromise(() =>
          readAdminSession(config, resource.database, request.headers),
        );
        return session.user
          ? Response.json(path === GetCurrentUser.path ? session.user : session.body, {
              headers: session.headers,
            })
          : Response.json({ code: "UNAUTHORIZED" } satisfies typeof AuthUnauthorized.Type, {
              status: 401,
              headers: session.headers,
            });
      }
      const response = yield* Effect.tryPromise(() => auth.handler(request));
      if (deliveryFailed) return yield* Effect.fail(new Error("OTP delivery failed"));
      return response;
    }),
  );
  try {
    const response = await Effect.runPromise(operation);
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    return new Response(response.body, { status: response.status, headers });
  } catch {
    console.error(JSON.stringify({ event: "auth_request_failed", path }));
    return Response.json(
      {
        code: "AUTH_UNAVAILABLE",
        message: "登录服务暂时不可用，请稍后重试。",
      } satisfies typeof AuthUnavailable.Type,
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
