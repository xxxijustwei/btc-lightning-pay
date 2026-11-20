import { PaymentsApi, PublicMerchant, PublicOrder } from "@btc-lightning-pay/api";
import { contractClient } from "./contract-client";

export { PublicApiError, type PublicApiErrorCode } from "./contract-client";
export type PublicMerchantData = typeof PublicMerchant.Type;
export type PublicOrderData = typeof PublicOrder.Type;

/** The payer's public payment endpoints, named and shaped as in the shared contract. */
export const publicApi = contractClient(PaymentsApi.groups.publicPayments.endpoints);

/** Cache key shared by the invoice page and the amount page, which seeds it with the created order. */
export const orderQueryKey = (orderId: string) => ["public-order", orderId] as const;
