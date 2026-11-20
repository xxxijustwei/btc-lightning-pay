import { queryOptions } from "@tanstack/react-query";
import { adminApi } from "../../lib/api/admin";

/** The platform has at most 100 merchants, so one request returns them all (also used for name lookups). */
export const allMerchantsQuery = () =>
  queryOptions({
    queryKey: ["admin", "merchants", "all"],
    queryFn: ({ signal }) => adminApi.merchants({ query: { limit: 100, offset: 0 } }, { signal }),
  });

export const merchantQuery = (merchantId: string) =>
  queryOptions({
    queryKey: ["admin", "merchant", merchantId],
    queryFn: ({ signal }) => adminApi.merchant({ params: { merchantId } }, { signal }),
  });

export const summaryQuery = (merchantId: string) =>
  queryOptions({
    queryKey: ["admin", "summary", merchantId],
    queryFn: ({ signal }) => adminApi.summary({ params: { merchantId } }, { signal }),
  });

export const allAdminsQuery = () =>
  queryOptions({
    queryKey: ["admin", "users", "admins"],
    queryFn: ({ signal }) =>
      adminApi.users({ query: { limit: 100, offset: 0, role: "admin" } }, { signal }),
  });

export const orderQuery = (orderId: string) =>
  queryOptions({
    queryKey: ["admin", "order", orderId],
    queryFn: ({ signal }) => adminApi.order({ params: { orderId } }, { signal }),
  });

export const settlementQuery = (settlementId: string) =>
  queryOptions({
    queryKey: ["admin", "settlement", settlementId],
    queryFn: ({ signal }) => adminApi.settlement({ params: { settlementId } }, { signal }),
  });

/** Whether the merchant has a settlement batch awaiting payment: `total` counts them. */
export const pendingSettlementsQuery = (merchantId: string) =>
  queryOptions({
    queryKey: ["admin", "settlements", { merchantId, status: "pending", limit: 1 }],
    queryFn: ({ signal }) =>
      adminApi.settlements(
        { query: { merchantId, status: "pending", limit: 1, offset: 0 } },
        { signal },
      ),
  });

/** The merchant's five newest settlement batches. */
export const recentSettlementsQuery = (merchantId: string) =>
  queryOptions({
    queryKey: ["admin", "settlements", { merchantId, limit: 5 }],
    queryFn: ({ signal }) =>
      adminApi.settlements({ query: { merchantId, limit: 5, offset: 0 } }, { signal }),
  });
