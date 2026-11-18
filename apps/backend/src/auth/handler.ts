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
import { parseAuthConfig, type AuthBindings } from "./config";
import { createOTPSender } from "./email";

const AuthSession = Schema.NullOr(Schema.Struct({ user: AuthUser }));

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
        const response = yield* Effect.tryPromise(() =>
          auth.api.getSession({ headers: request.headers, asResponse: true }),
        );
        if (!response.ok) return yield* Effect.fail(new Error("Session lookup failed"));
        const value = yield* Effect.tryPromise(() => response.json());
        const session = Schema.decodeUnknownSync(AuthSession)(value);
        const headers = new Headers(response.headers);
        headers.delete("content-length");
        const [current] = session
          ? yield* Effect.tryPromise(() =>
              resource.database.select().from(users).where(eq(users.id, session.user.id)),
            )
          : [];
        return session && current?.role === "admin" && !current.banned
          ? Response.json(
              path === GetCurrentUser.path
                ? Schema.decodeUnknownSync(AuthUser)(session.user)
                : value,
              { headers },
            )
          : Response.json({ code: "UNAUTHORIZED" } satisfies typeof AuthUnauthorized.Type, {
              status: 401,
              headers,
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
