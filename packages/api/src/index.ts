import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

export const Health = Schema.Struct({ status: Schema.Literal("ok") });

export const Api = HttpApi.make("LightningPayApi").add(
  HttpApiGroup.make("health").add(HttpApiEndpoint.get("get", "/api/health", { success: Health })),
);

export const AuthUser = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  image: Schema.optional(Schema.NullOr(Schema.String)),
});
export const AuthUnauthorized = Schema.Struct({ code: Schema.Literal("UNAUTHORIZED") }).annotate({
  httpApiStatus: 401,
});
export const AuthUnavailable = Schema.Struct({
  code: Schema.Literals(["AUTH_NOT_CONFIGURED", "AUTH_UNAVAILABLE"]),
  message: Schema.String,
}).annotate({ httpApiStatus: 503 });
export const GetCurrentUser = HttpApiEndpoint.get("getCurrentUser", "/api/me", {
  success: AuthUser,
  error: [AuthUnauthorized, AuthUnavailable],
});
