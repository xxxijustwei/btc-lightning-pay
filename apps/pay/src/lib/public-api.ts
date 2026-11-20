import { PaymentsApi, PublicMerchant, PublicOrder } from "@btc-lightning-pay/api";
import { contractClient, PublicApiError } from "./contract-client";

export { PublicApiError, type PublicApiErrorCode } from "./contract-client";
export type PublicMerchantData = typeof PublicMerchant.Type;
export type PublicOrderData = typeof PublicOrder.Type;

/** The payer's public payment endpoints, named and shaped as in the shared contract. */
export const publicApi = contractClient(PaymentsApi.groups.publicPayments.endpoints);

/** How long to keep retrying while the backend is still issuing this key's invoice. */
const IN_PROGRESS_RETRY_MS = 1_000;
const IN_PROGRESS_ATTEMPTS = 20;
const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

/**
 * Creates the order for this idempotency key. While another request with the same key is still
 * being invoiced, the backend answers ORDER_IN_PROGRESS; the same key is retried until it settles.
 */
export async function createOrder(
  slug: string,
  input: { amountUsdCents: number },
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await publicApi.createOrder(
        {
          params: { slug },
          headers: { "idempotency-key": idempotencyKey },
          payload: input,
        },
        { signal },
      );
    } catch (error) {
      if (
        !(error instanceof PublicApiError) ||
        error.code !== "ORDER_IN_PROGRESS" ||
        attempt >= IN_PROGRESS_ATTEMPTS
      )
        throw error;
      await pause(IN_PROGRESS_RETRY_MS, signal);
    }
  }
}

/** Cache key shared by the invoice page and the amount page, which seeds it with the created order. */
export const orderQueryKey = (orderId: string) => ["public-order", orderId] as const;
