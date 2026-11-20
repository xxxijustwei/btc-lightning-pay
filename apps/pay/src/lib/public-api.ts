import type { PublicMerchant, PublicOrder } from "@btc-lightning-pay/api/schemas";
import { failure, PublicApiError, type EndpointInput } from "./contract-client";
import { createOrderFn, merchantFn, orderFn } from "./public-api.functions";
import type { PublicEndpoints, PublicOutcome } from "./public-calls";

export { PublicApiError, type PublicApiErrorCode } from "./contract-client";
export type PublicMerchantData = typeof PublicMerchant.Type;
export type PublicOrderData = typeof PublicOrder.Type;

/** Longer than the server's own wait for the backend, so its answer normally arrives first. */
const TIMEOUT_MS = 20_000;

/** Calls one server function and turns its outcome back into a value or a `PublicApiError`. */
async function invoke<T>(
  run: (signal: AbortSignal) => Promise<PublicOutcome<T>>,
  signal?: AbortSignal,
): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new DOMException("The request timed out.", "TimeoutError")),
    TIMEOUT_MS,
  );
  let outcome: PublicOutcome<T>;
  try {
    outcome = await run(signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal);
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw failure(timeout.signal.aborted ? "TIMEOUT" : "NETWORK", 0);
  } finally {
    clearTimeout(timer);
  }
  if (typeof outcome !== "object" || outcome === null) {
    throw new PublicApiError("UNEXPECTED_RESPONSE", false, true);
  }
  if (outcome.ok) return outcome.value;
  throw new PublicApiError(outcome.code, outcome.retryable, outcome.outcomeUnknown);
}

type Input<Name extends keyof PublicEndpoints> = EndpointInput<PublicEndpoints[Name]>;
type Options = { signal?: AbortSignal };

/** The payer's public payment operations, named and shaped as in the shared contract. */
export const publicApi = {
  merchant: (data: Input<"merchant">, options?: Options) =>
    invoke((signal) => merchantFn({ data, signal }), options?.signal),
  createOrder: (data: Input<"createOrder">, options?: Options) =>
    invoke((signal) => createOrderFn({ data, signal }), options?.signal),
  order: (data: Input<"order">, options?: Options) =>
    invoke((signal) => orderFn({ data, signal }), options?.signal),
};

/** Cache key shared by the invoice page and the amount page, which seeds it with the created order. */
export const orderQueryKey = (orderId: string) => ["public-order", orderId] as const;
