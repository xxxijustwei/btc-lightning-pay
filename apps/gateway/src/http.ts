import { paymentErrorStatus, type PaymentErrorCode } from "@btc-lightning-pay/api/payments";
import { Context, Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpApiError } from "effect/http-api";
import { logGatewayFailure } from "./errors.ts";

export class RequestTrace extends Context.Service<RequestTrace, { requestId: string }>()(
  "gateway/RequestTrace",
) {}

export const problem = (code: PaymentErrorCode) =>
  HttpServerResponse.jsonUnsafe(
    { code, message: code },
    { status: paymentErrorStatus[code], headers: { "cache-control": "no-store" } },
  );
export const errorBoundary = HttpRouter.middleware<{ provides: RequestTrace }>()((effect) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const candidate = request.headers["x-request-id"] ?? "";
    const requestId = /^[0-9a-f-]{36}$/.test(candidate) ? candidate : crypto.randomUUID();
    const response = yield* effect.pipe(
      Effect.provideService(RequestTrace, { requestId }),
      Effect.catchDefect((error) => {
        const code = HttpApiError.HttpApiPayloadTooLarge.is(error)
          ? "BODY_TOO_LARGE"
          : HttpApiError.HttpApiSchemaError.is(error) &&
              error.kind !== "Body" &&
              error.kind !== "ResponseHeaders"
            ? "INVALID_INPUT"
            : "INTERNAL_ERROR";
        logGatewayFailure({ operation: "http_boundary", requestId, code });
        return Effect.succeed(problem(code));
      }),
      Effect.map((response) => (response.status === 415 ? problem("INVALID_INPUT") : response)),
    );
    return HttpServerResponse.setHeader(response, "x-request-id", requestId);
  }),
).layer;
