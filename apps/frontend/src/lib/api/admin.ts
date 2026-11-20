import {
  AdminOrder,
  ManagedUser,
  Merchant,
  PaymentsApi,
  Settlement,
  Summary,
} from "@btc-lightning-pay/api";
import { AdminApiError, contractClient, type AdminApiErrorCode } from "./contract-client";

export { AdminApiError, type AdminApiErrorCode } from "./contract-client";
export type MerchantData = typeof Merchant.Type;
export type ManagedUserData = typeof ManagedUser.Type;
export type AdminOrderData = typeof AdminOrder.Type;
export type SettlementData = typeof Settlement.Type;
export type SummaryData = typeof Summary.Type;
export type PaymentStatusValue = AdminOrderData["status"];
export type SettlementStatusValue = SettlementData["status"];

/** The admin console's endpoints, named and shaped as in the shared contract. */
export const adminApi = contractClient(PaymentsApi.groups.adminPayments.endpoints);

/** One message per failure; a new contract code without a message here is a type error. */
const messages: Record<AdminApiErrorCode, string> = {
  NETWORK: "无法连接服务，请检查网络后重试。",
  TIMEOUT: "服务响应超时，请稍后重试。",
  UNEXPECTED_RESPONSE: "服务返回了无法识别的结果，请刷新后查看。",
  BACKEND_UNAVAILABLE: "后端服务暂时不可用，请稍后重试。",
  UNAUTHORIZED: "登录已失效，请重新登录。",
  ADMIN_REQUIRED: "当前账号没有管理权限。",
  ORIGIN_REJECTED: "请求来源不被信任，请从管理端页面操作。",
  INVALID_INPUT: "输入不合法，请检查后重试。",
  BODY_TOO_LARGE: "提交的内容过长，请精简后重试。",
  INVALID_DATE: "日期范围不合法，请重新选择。",
  INVALID_PAGINATION: "分页参数不合法，请返回第一页。",
  EMAIL_EXISTS: "该邮箱已有账号，不能绑定已有账号。",
  MERCHANT_EXISTS: "该 slug 已被使用，slug 不会回收。",
  LAST_ADMIN: "不能禁用最后一位启用的管理员。请先新建或恢复另一位管理员。",
  USER_IS_MERCHANT: "商户账号请在商户页面启用或停用。",
  NO_ELIGIBLE_ORDERS: "当前没有可结算的订单。",
  SETTLEMENT_STATE_CONFLICT: "结算单状态已变化，请刷新后查看。",
  SETTLEMENT_PROOF_CONFLICT: "该结算单已用不同的凭证确认过。",
  SETTLEMENT_REASON_CONFLICT: "该结算单已用不同的原因取消过。",
  IDEMPOTENCY_CONFLICT: "该请求已用不同内容提交过，请刷新后重试。",
  ORDER_IN_PROGRESS: "订单仍在创建中，请稍后重试。",
  MERCHANT_DISABLED: "商户已停用。",
  PAYMENT_MISMATCH: "收款与订单不符，已记录待人工跟进。",
  NOT_FOUND: "请求的内容不存在。",
  MERCHANT_NOT_FOUND: "商户不存在。",
  ORDER_NOT_FOUND: "订单不存在。",
  SETTLEMENT_NOT_FOUND: "结算单不存在。",
  USER_NOT_FOUND: "账号不存在。",
  RATE_LIMITED: "操作太频繁，请稍后重试。",
  INTERNAL_ERROR: "服务暂时不可用，请稍后重试。",
  QUOTE_UNAVAILABLE: "暂时无法获取 BTC 报价，请稍后重试。",
  WALLET_NOT_CONFIGURED: "钱包尚未配置。",
  PAYMENTS_NOT_CONFIGURED: "收款服务尚未配置。",
  PAYMENTS_UNAVAILABLE: "服务暂时不可用，请稍后重试。",
  WALLET_UNAVAILABLE: "钱包服务暂时不可用，请稍后重试。",
  AMOUNT_OVERFLOW: "金额超出可处理范围。",
};

/** User-facing Chinese message for a failed admin call; never shows backend internals. */
export function describeAdminError(error: unknown) {
  return error instanceof AdminApiError ? messages[error.code] : "操作失败，请稍后重试。";
}
