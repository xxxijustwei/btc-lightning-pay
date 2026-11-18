const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** `?merchantId=` filter shared by the order and settlement lists; invalid values are dropped. */
export function merchantFilterSearch(search: Record<string, unknown>): { merchantId?: string } {
  return typeof search.merchantId === "string" && UUID.test(search.merchantId)
    ? { merchantId: search.merchantId }
    : {};
}
