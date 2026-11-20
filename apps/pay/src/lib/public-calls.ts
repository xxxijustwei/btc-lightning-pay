import { PaymentsApi } from "@btc-lightning-pay/api";
import { contractClient, PublicApiError, type PublicApiErrorCode } from "./contract-client";

/** The only backend endpoints the payer app calls. */
export const publicEndpoints = PaymentsApi.groups.publicPayments.endpoints;
export type PublicEndpoints = typeof publicEndpoints;

/** A payer call's result as it crosses to the browser: failures travel as data, never thrown. */
export type PublicOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly code: PublicApiErrorCode;
      readonly retryable: boolean;
      readonly outcomeUnknown: boolean;
    };

export async function settle<T>(run: () => Promise<T>): Promise<PublicOutcome<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (!(error instanceof PublicApiError)) throw error;
    const { code, retryable, outcomeUnknown } = error;
    return { ok: false, code, retryable, outcomeUnknown };
  }
}

type Backend = { fetch(request: Request): Promise<Response> };

/**
 * The backend's public endpoints, called over the service binding on behalf of one payer request.
 * Only the payer's IP goes along, for the backend's rate limits; cookies and credentials never do.
 */
export function backendCalls(request: Request, backend: Backend) {
  const ip = request.headers.get("cf-connecting-ip");
  return contractClient(publicEndpoints, async (path, init) => {
    const headers = new Headers(init.headers);
    if (ip) headers.set("cf-connecting-ip", ip);
    try {
      return await backend.fetch(
        new Request(new URL(path, "https://backend"), { ...init, headers, redirect: "manual" }),
      );
    } catch (cause) {
      if (init.signal?.aborted) throw cause;
      return Response.json(
        { code: "BACKEND_UNAVAILABLE", message: "The payment service is unavailable." },
        { status: 502 },
      );
    }
  });
}
