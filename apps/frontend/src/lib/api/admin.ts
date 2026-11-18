import {
  AdminOrder,
  ManagedUser,
  Merchant,
  Settlement,
  SettlementOrderPage,
  SettlementPage,
  Summary,
} from "@btc-lightning-pay/api";
import { Schema } from "effect";

export type MerchantData = typeof Merchant.Type;
export type ManagedUserData = typeof ManagedUser.Type;
export type AdminOrderData = typeof AdminOrder.Type;
export type SettlementData = typeof Settlement.Type;
export type SummaryData = typeof Summary.Type;
export type PaymentStatusValue = AdminOrderData["status"];
export type SettlementStatusValue = SettlementData["status"];

/** A failed admin API call. `status` 0 means no response arrived. */
export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
  }
}

type Query = Record<string, string | number | undefined>;

function withQuery(path: string, query?: Query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

async function call<T>(
  path: string,
  decode: (input: unknown) => T,
  init: RequestInit & { query?: Query } = {},
): Promise<T> {
  const { query, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(withQuery(path, query), {
      ...rest,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(rest.body ? { "content-type": "application/json" } : {}),
        ...rest.headers,
      },
    });
  } catch (cause) {
    if (rest.signal?.aborted) throw cause;
    throw new AdminApiError(0, "NETWORK", "无法连接服务。");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = body as { code?: unknown; message?: unknown } | null;
    throw new AdminApiError(
      response.status,
      typeof problem?.code === "string" ? problem.code : `HTTP_${response.status}`,
      typeof problem?.message === "string" ? problem.message : "请求失败。",
    );
  }
  return decode(body);
}

const json = (body: unknown) => JSON.stringify(body);

export const adminApi = {
  merchants: (query: { limit: number; offset: number }, signal?: AbortSignal) =>
    call("/api/admin/merchants", Schema.decodeUnknownSync(Schema.Array(Merchant)), {
      query,
      signal,
    }),
  merchant: (merchantId: string, signal?: AbortSignal) =>
    call(`/api/admin/merchants/${merchantId}`, Schema.decodeUnknownSync(Merchant), { signal }),
  createMerchant: (input: { name: string; email: string; slug: string }) =>
    call("/api/admin/merchants", Schema.decodeUnknownSync(Merchant), {
      method: "POST",
      body: json(input),
    }),
  updateMerchant: (merchantId: string, input: { name?: string; enabled?: boolean }) =>
    call(`/api/admin/merchants/${merchantId}`, Schema.decodeUnknownSync(Merchant), {
      method: "PATCH",
      body: json(input),
    }),
  summary: (merchantId: string, signal?: AbortSignal) =>
    call(`/api/admin/merchants/${merchantId}/summary`, Schema.decodeUnknownSync(Summary), {
      signal,
    }),

  orders: (
    query: {
      limit: number;
      offset: number;
      merchantId?: string;
      status?: PaymentStatusValue;
      from?: string;
      to?: string;
    },
    signal?: AbortSignal,
  ) =>
    call("/api/admin/orders", Schema.decodeUnknownSync(Schema.Array(AdminOrder)), {
      query,
      signal,
    }),
  order: (orderId: string, signal?: AbortSignal) =>
    call(`/api/admin/orders/${orderId}`, Schema.decodeUnknownSync(AdminOrder), { signal }),

  settlements: (
    query: {
      limit: number;
      offset: number;
      merchantId?: string;
      status?: SettlementStatusValue;
      from?: string;
      to?: string;
    },
    signal?: AbortSignal,
  ) => call("/api/admin/settlements", Schema.decodeUnknownSync(SettlementPage), { query, signal }),
  settlement: (settlementId: string, signal?: AbortSignal) =>
    call(`/api/admin/settlements/${settlementId}`, Schema.decodeUnknownSync(Settlement), {
      signal,
    }),
  settlementOrders: (
    settlementId: string,
    query: { limit: number; offset: number },
    signal?: AbortSignal,
  ) =>
    call(
      `/api/admin/settlements/${settlementId}/orders`,
      Schema.decodeUnknownSync(SettlementOrderPage),
      {
        query,
        signal,
      },
    ),
  createSettlement: (merchantId: string, idempotencyKey: string) =>
    call("/api/admin/settlements", Schema.decodeUnknownSync(Settlement), {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: json({ merchantId }),
    }),
  confirmSettlement: (settlementId: string, proof: string) =>
    call(`/api/admin/settlements/${settlementId}/confirm`, Schema.decodeUnknownSync(Settlement), {
      method: "POST",
      body: json({ proof }),
    }),
  cancelSettlement: (settlementId: string, reason: string) =>
    call(`/api/admin/settlements/${settlementId}/cancel`, Schema.decodeUnknownSync(Settlement), {
      method: "POST",
      body: json({ reason }),
    }),

  users: (
    query: { limit: number; offset: number; role?: "admin" | "merchant" },
    signal?: AbortSignal,
  ) =>
    call("/api/admin/users", Schema.decodeUnknownSync(Schema.Array(ManagedUser)), {
      query,
      signal,
    }),
  createAdmin: (input: { name: string; email: string }) =>
    call("/api/admin/users", Schema.decodeUnknownSync(ManagedUser), {
      method: "POST",
      body: json(input),
    }),
  updateUser: (userId: string, input: { banned: boolean }) =>
    call(`/api/admin/users/${userId}`, Schema.decodeUnknownSync(ManagedUser), {
      method: "PATCH",
      body: json(input),
    }),
};

const messages: Record<string, string> = {
  NETWORK: "无法连接服务，请检查网络后重试。",
  UNAUTHORIZED: "登录已失效，请重新登录。",
  ADMIN_REQUIRED: "当前账号没有管理权限。",
  ORIGIN_REJECTED: "请求来源不被信任，请从管理端页面操作。",
  INVALID_INPUT: "输入不合法，请检查后重试。",
  EMAIL_EXISTS: "该邮箱已有账号，不能绑定已有账号。",
  MERCHANT_EXISTS: "该 slug 已被使用，slug 不会回收。",
  LAST_ADMIN: "不能禁用最后一位启用的管理员。",
  NO_ELIGIBLE_ORDERS: "当前没有可结算的订单。",
  SETTLEMENT_STATE_CONFLICT: "结算单状态已变化，请刷新后查看。",
  SETTLEMENT_PROOF_CONFLICT: "该结算单已用不同的凭证确认过。",
  SETTLEMENT_REASON_CONFLICT: "该结算单已用不同的原因取消过。",
  MERCHANT_NOT_FOUND: "商户不存在。",
  ORDER_NOT_FOUND: "订单不存在。",
  SETTLEMENT_NOT_FOUND: "结算单不存在。",
  USER_NOT_FOUND: "账号不存在。",
  RATE_LIMITED: "操作太频繁，请稍后重试。",
};

/** User-facing Chinese message for a failed admin call; never shows backend internals. */
export function describeAdminError(error: unknown) {
  if (error instanceof AdminApiError) {
    const known = messages[error.code];
    if (known) return known;
    if (error.status >= 500) return "服务暂时不可用，请稍后重试。";
  }
  return "操作失败，请稍后重试。";
}
