import { AUTH_COOKIE_PREFIX, AuthUser, GetCurrentUser } from "@btc-lightning-pay/api";
import { getSessionCookie } from "better-auth/cookies";
import { Schema } from "effect";

export async function readCurrentUser(
  request: Request,
  fetchBackend: (request: Request) => Promise<Response>,
  appendCookie: (cookie: string) => void,
) {
  const cookie = request.headers.get("cookie");
  if (!cookie || !getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX })) return null;
  const response = await fetchBackend(
    new Request(`https://backend${GetCurrentUser.path}`, {
      headers: { cookie },
      signal: request.signal,
    }),
  );
  for (const value of response.headers.getSetCookie()) appendCookie(value);
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("登录服务暂时不可用，请稍后重试。");
  return Schema.decodeUnknownSync(AuthUser)(await response.json());
}
