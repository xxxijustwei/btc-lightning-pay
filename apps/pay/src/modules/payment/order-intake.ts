import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { publicApi, PublicApiError, type PublicOrderData } from "../../lib/public-api";

/** How long and how often to wait while the backend is still issuing this key's invoice. */
const IN_PROGRESS_RETRY_MS = 1_000;
const IN_PROGRESS_ATTEMPTS = 20;

/**
 * 128 random bits as 32 hex characters, valid as the contract's idempotency key. Uses
 * `getRandomValues` rather than `randomUUID`, which needs a secure context and newer browsers.
 */
function newIdempotencyKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Only an unknown outcome or an invoice still being issued may have created the order. */
const keepsKey = (error: PublicApiError) =>
  error.outcomeUnknown || error.code === "ORDER_IN_PROGRESS";

/**
 * Order intake for one merchant: `mutate(amountUsdCents)` creates the order and its invoice.
 * Every submission of one amount reuses one idempotency key until the backend gives a definite
 * answer, so a retry never opens a second order. The key lives only in memory on purpose: after
 * a page reload the payer starts a new order.
 */
export function useOrderIntake(
  slug: string,
  options: {
    onSuccess?: (order: PublicOrderData) => void;
    onError?: (error: PublicApiError) => void;
  } = {},
) {
  const attempt = useRef<{ cents: number; key: string } | null>(null);
  return useMutation<PublicOrderData, PublicApiError, number>({
    mutationFn: (amountUsdCents) => {
      if (!attempt.current || attempt.current.cents !== amountUsdCents) {
        attempt.current = { cents: amountUsdCents, key: newIdempotencyKey() };
      }
      return publicApi.createOrder({
        params: { slug },
        headers: { "idempotency-key": attempt.current.key },
        payload: { amountUsdCents },
      });
    },
    retry: (failures, error) =>
      error.code === "ORDER_IN_PROGRESS" && failures < IN_PROGRESS_ATTEMPTS - 1,
    retryDelay: IN_PROGRESS_RETRY_MS,
    onSuccess: (order) => {
      attempt.current = null;
      options.onSuccess?.(order);
    },
    onError: (error) => {
      if (!(error instanceof PublicApiError) || !keepsKey(error)) attempt.current = null;
      options.onError?.(error);
    },
  });
}
