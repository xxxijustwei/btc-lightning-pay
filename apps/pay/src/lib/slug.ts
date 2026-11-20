import { MerchantSlug, OrderId } from "@btc-lightning-pay/api/schemas";
import { Schema } from "effect";

export const isMerchantSlug: (value: unknown) => value is string = Schema.is(MerchantSlug);

export const isOrderId: (value: unknown) => value is string = Schema.is(OrderId);
