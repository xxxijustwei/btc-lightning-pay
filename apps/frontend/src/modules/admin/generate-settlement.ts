import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { AdminApiError, adminApi, type SettlementData } from "../../lib/api/admin";

/**
 * 128 random bits as 32 hex characters, valid as the contract's idempotency key. Uses
 * `getRandomValues` rather than `randomUUID`, which needs a secure context and newer browsers.
 */
function newIdempotencyKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Fixes the merchant's paid, unsettled orders into a settlement batch: `mutate()` generates it.
 * Repeated clicks reuse one idempotency key until the backend gives a definite answer, so a retry
 * after a lost response returns the same batch instead of a second one. The key lives only in
 * memory on purpose: after a page reload the admin starts a new attempt.
 */
export function useGenerateSettlement(
  merchantId: string,
  options: {
    onSuccess?: (settlement: SettlementData) => void | Promise<void>;
    onError?: (error: AdminApiError) => void;
  } = {},
) {
  const key = useRef<string | null>(null);
  return useMutation<SettlementData, AdminApiError, void>({
    mutationFn: () => {
      key.current ??= newIdempotencyKey();
      return adminApi.settle({
        headers: { "idempotency-key": key.current },
        payload: { merchantId },
      });
    },
    onSuccess: async (settlement) => {
      key.current = null;
      await options.onSuccess?.(settlement);
    },
    onError: (error) => {
      // Only an unknown outcome may have created the batch; any definite answer starts fresh.
      if (!(error instanceof AdminApiError) || !error.outcomeUnknown) key.current = null;
      options.onError?.(error);
    },
  });
}
