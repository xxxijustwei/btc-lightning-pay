import { paymentErrorStatus, type PaymentErrorCode } from "@btc-lightning-pay/api";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpApiError } from "effect/http-api";
import { paymentLogger } from "./logging";
export const problem = (code: PaymentErrorCode) =>
  HttpServerResponse.jsonUnsafe(
    { code, message: code },
    {
      status: paymentErrorStatus[code],
      headers: {
        "cache-control": "no-store",
        // Another request is issuing this key's invoice; it finishes within seconds.
        ...(code === "ORDER_IN_PROGRESS" ? { "retry-after": "1" } : {}),
      },
    },
  );
export const errorBoundary = HttpRouter.middleware((effect) =>
  effect.pipe(
    Effect.catchDefect((error) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const candidate = request.headers["x-request-id"] ?? "";
        const requestId = /^[0-9a-f-]{36}$/.test(candidate) ? candidate : crypto.randomUUID();
        const code = HttpApiError.HttpApiPayloadTooLarge.is(error)
          ? "BODY_TOO_LARGE"
          : HttpApiError.HttpApiSchemaError.is(error) &&
              error.kind !== "Body" &&
              error.kind !== "ResponseHeaders"
            ? "INVALID_INPUT"
            : "INTERNAL_ERROR";
        paymentLogger(requestId)({ operation: "http_boundary", code });
        return problem(code);
      }),
    ),
    Effect.map((response) => (response.status === 415 ? problem("INVALID_INPUT") : response)),
  ),
).layer;
