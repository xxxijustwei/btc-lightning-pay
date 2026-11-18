const SLUG = /^[a-z][a-z0-9-]{2,31}$/;
const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isMerchantSlug(value: unknown): value is string {
  return typeof value === "string" && SLUG.test(value);
}

export function isOrderId(value: unknown): value is string {
  return typeof value === "string" && ORDER_ID.test(value);
}
