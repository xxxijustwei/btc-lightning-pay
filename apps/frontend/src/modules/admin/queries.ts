import { queryOptions } from "@tanstack/react-query";
import { adminApi } from "../../lib/api/admin";

/** The platform has at most 100 merchants, so one request returns them all (also used for name lookups). */
export const allMerchantsQuery = () =>
  queryOptions({
    queryKey: ["admin", "merchants", "all"],
    queryFn: ({ signal }) => adminApi.merchants({ limit: 100, offset: 0 }, signal),
  });

export const merchantQuery = (merchantId: string) =>
  queryOptions({
    queryKey: ["admin", "merchant", merchantId],
    queryFn: ({ signal }) => adminApi.merchant(merchantId, signal),
  });

export const summaryQuery = (merchantId: string) =>
  queryOptions({
    queryKey: ["admin", "summary", merchantId],
    queryFn: ({ signal }) => adminApi.summary(merchantId, signal),
  });

export const allAdminsQuery = () =>
  queryOptions({
    queryKey: ["admin", "users", "admins"],
    queryFn: ({ signal }) => adminApi.users({ limit: 100, offset: 0, role: "admin" }, signal),
  });
