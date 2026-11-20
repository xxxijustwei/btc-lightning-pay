import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  orderQueryKey,
  publicApi,
  PublicApiError,
  type PublicOrderData,
} from "../../lib/public-api";

const ACTIVE_POLL_MS = 3_000;
const HIDDEN_POLL_MS = 15_000;
const EXPIRED_POLL_MS = 15_000;
const MAX_BACKOFF_MS = 30_000;
/** The backend stops asking the wallet this long after expiry, so polling stops too. */
const POLL_AFTER_EXPIRY_MS = 10 * 60_000;

/** What the payer's invoice page shows for one order. */
export type OrderStatus =
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "offline"; retry: () => void }
  /** `deadline` is the invoice expiry on this device's clock, in epoch milliseconds. */
  | { kind: "pending"; order: PublicOrderData; deadline: number; reconnecting: boolean }
  | { kind: "paid"; order: PublicOrderData }
  | { kind: "expired"; order: PublicOrderData; reconnecting: boolean };

/** The invoice expiry moved onto this device's clock, using the server time the response carried. */
const localDeadline = (order: PublicOrderData, receivedAt: number) =>
  Date.parse(order.expiresAt) - (Date.parse(order.serverTime) - receivedAt);

function pollDelay(
  order: PublicOrderData | undefined,
  receivedAt: number,
  error: unknown,
  failures: number,
): number | false {
  if (error instanceof PublicApiError && error.code === "ORDER_NOT_FOUND") return false;
  if (failures > 0) return Math.min(ACTIVE_POLL_MS * 2 ** failures, MAX_BACKOFF_MS);
  if (order?.status === "paid") return false;
  if (order?.status === "expired") {
    const pastExpiry = Date.now() - localDeadline(order, receivedAt);
    return pastExpiry > POLL_AFTER_EXPIRY_MS ? false : EXPIRED_POLL_MS;
  }
  if (typeof document !== "undefined" && document.visibilityState === "hidden")
    return HIDDEN_POLL_MS;
  return ACTIVE_POLL_MS;
}

/**
 * The payer's view of one order, kept current by polling: fast while the payer looks, slower in
 * the background, backing off after failed refreshes, and once more the moment the invoice
 * expires. The backend decides the status; a failed refresh keeps the last known order and
 * reports `reconnecting` rather than a payment failure.
 */
export function useOrderStatus(orderId: string): OrderStatus {
  // Consecutive failed refreshes. TanStack restarts its own failure count on every fetch.
  const failures = useRef(0);
  const query = useQuery({
    queryKey: orderQueryKey(orderId),
    queryFn: async ({ signal }) => {
      try {
        const order = await publicApi.order({ params: { orderId } }, { signal });
        failures.current = 0;
        return order;
      } catch (error) {
        if (!signal.aborted) failures.current += 1;
        throw error;
      }
    },
    // The amount page seeds a fresh order; don't fetch it again on arrival, the poll takes over.
    staleTime: ACTIVE_POLL_MS,
    refetchInterval: ({ state }) =>
      pollDelay(state.data, state.dataUpdatedAt, state.error, failures.current),
    refetchIntervalInBackground: true,
    retry: false,
  });

  const order = query.data;
  const deadline = order ? localDeadline(order, query.dataUpdatedAt) : null;
  const pending = order?.status === "pending";
  const { refetch } = query;
  useEffect(() => {
    if (!pending || deadline === null) return;
    const untilExpiry = deadline - Date.now();
    if (untilExpiry <= 0) return;
    // Ask right away when the invoice expires instead of waiting for the next poll.
    const timer = setTimeout(() => void refetch(), untilExpiry);
    return () => clearTimeout(timer);
  }, [pending, deadline, refetch]);

  if (query.isPending) return { kind: "loading" };
  if (!order || deadline === null) {
    if (query.error instanceof PublicApiError && query.error.code === "ORDER_NOT_FOUND") {
      return { kind: "notFound" };
    }
    return { kind: "offline", retry: () => void refetch() };
  }
  const reconnecting = query.isError;
  switch (order.status) {
    case "pending":
      return { kind: "pending", order, deadline, reconnecting };
    case "paid":
      return { kind: "paid", order };
    case "expired":
      return { kind: "expired", order, reconnecting };
  }
}

/** Milliseconds left until `deadline`, refreshed every second and never below zero. */
export function useRemaining(deadline: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, deadline - now);
}
