import { PaymentFailure, StorageFailure, UpstreamFailure } from "./errors";

export type PaymentLog = (entry: {
  operation: string;
  code: string;
  durationMs?: number;
  orderId?: string;
  dependency?: string;
  reason?: string;
  upstreamStatus?: number;
}) => void;
export const paymentLogger =
  (requestId: string): PaymentLog =>
  (entry) => {
    console.error(JSON.stringify({ event: "payment_failure", requestId, ...entry }));
  };
export function errorFields(error: unknown) {
  if (error instanceof PaymentFailure) return { code: error.code };
  if (error instanceof UpstreamFailure)
    return {
      code: "UPSTREAM_FAILURE",
      dependency: error.dependency,
      reason: error.reason,
      upstreamStatus: error.upstreamStatus,
    };
  if (error instanceof StorageFailure) return { code: "STORAGE_FAILURE", reason: error.operation };
  return { code: "INTERNAL_ERROR" };
}
