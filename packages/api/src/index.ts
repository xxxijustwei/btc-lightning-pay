import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

export const Health = Schema.Struct({ status: Schema.Literal("ok") });

export const InvoiceAmount = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 }));
export const CreateInvoiceInput = Schema.Struct({
  amountSat: InvoiceAmount,
  description: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
});
export const Invoice = Schema.Struct({
  amountSat: InvoiceAmount,
  paymentHash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  serialized: Schema.String.check(Schema.isPattern(/^lnbc[0-9a-z]+$/), Schema.isMaxLength(4096)),
});
export const InvoiceUnavailable = Schema.Struct({
  code: Schema.Literal("INVOICE_UNAVAILABLE"),
  message: Schema.String,
}).annotate({ httpApiStatus: 503 });

export const Api = HttpApi.make("LightningPayApi").add(
  HttpApiGroup.make("health").add(HttpApiEndpoint.get("get", "/api/health", { success: Health })),
  HttpApiGroup.make("invoices").add(
    HttpApiEndpoint.post("create", "/api/invoices", {
      payload: CreateInvoiceInput,
      success: Invoice,
      error: InvoiceUnavailable,
    }),
  ),
);

export const AUTH_COOKIE_PREFIX = "btc-lightning-pay";

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
