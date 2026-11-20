import { MerchantId, PaymentStatus, SettlementStatus } from "@btc-lightning-pay/api";
import { Schema } from "effect";
import {
  createParser,
  createStandardSchemaV1,
  parseAsIndex,
  parseAsNumberLiteral,
  parseAsStringLiteral,
} from "nuqs";
import type { PaginationState, Updater } from "@tanstack/react-table";
import { beijingDayEnd, beijingDayStart } from "./format";

/**
 * URL state for admin lists. nuqs owns reading and writing; each route also registers
 * the matching `validateSearch` so TanStack Router links stay typed.
 */
export const PAGE_SIZES = [10, 20, 30, 40, 50] as const;

const isMerchantId = Schema.is(MerchantId);
const parseAsMerchantId = createParser({
  parse: (value) => (isMerchantId(value) ? value : null),
  serialize: (value: string) => value,
});

/** Calendar day `yyyy-MM-dd`, interpreted in Beijing time when sent to the API. */
const parseAsDay = createParser({
  parse: (value) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null),
  serialize: (value: string) => value,
});

/** `?page=` is 1-based in the URL and a 0-based page index in code. */
export const paginationParsers = {
  page: parseAsIndex.withDefault(0),
  size: parseAsNumberLiteral(PAGE_SIZES).withDefault(10),
};

export const merchantsSearch = {
  ...paginationParsers,
  status: parseAsStringLiteral(["enabled", "disabled"] as const),
};

export const ordersSearch = {
  ...paginationParsers,
  merchantId: parseAsMerchantId,
  status: parseAsStringLiteral(PaymentStatus.literals),
  from: parseAsDay,
  to: parseAsDay,
};

export const settlementsSearch = {
  ...paginationParsers,
  merchantId: parseAsMerchantId,
  status: parseAsStringLiteral(SettlementStatus.literals),
  from: parseAsDay,
  to: parseAsDay,
};

export const accountsSearch = {
  ...paginationParsers,
  role: parseAsStringLiteral(["admin", "merchant"] as const),
};

export const searchSchema = <P extends Parameters<typeof createStandardSchemaV1>[0]>(parsers: P) =>
  createStandardSchemaV1(parsers, { partialOutput: true });

/** A Beijing calendar-day range from the URL as the UTC instants the API filters take. */
export function beijingRange(days: { from: string | null; to: string | null }) {
  return {
    from: days.from ? beijingDayStart(days.from) : undefined,
    to: days.to ? beijingDayEnd(days.to) : undefined,
  };
}

/** Next URL pagination for a table update; a new page size starts over from the first page. */
export function paginationUpdate(
  current: PaginationState,
  updater: Updater<PaginationState>,
): { page: number; size: (typeof PAGE_SIZES)[number] } {
  const next = typeof updater === "function" ? updater(current) : updater;
  const size = (PAGE_SIZES as readonly number[]).includes(next.pageSize)
    ? (next.pageSize as (typeof PAGE_SIZES)[number])
    : 10;
  return { page: size === current.pageSize ? next.pageIndex : 0, size };
}
