import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ColumnDef, RowData } from "@tanstack/react-table";
import { useQueryStates, type Nullable, type UseQueryStatesKeysMap, type Values } from "nuqs";
import { dataTableFeatures, useAppTable } from "../../components/data-table/table-hook";
import { paginationParsers, paginationUpdate } from "../../lib/list-search";

const noRows: never[] = [];

type Parsers = typeof paginationParsers & UseQueryStatesKeysMap;
type Filters<P extends Parsers> = Omit<Values<P>, "page" | "size">;

/**
 * A paginated admin list backed by the API. The URL owns the page, page size and filters;
 * this module fetches the page, keeps the previous page on screen while the next loads, and
 * drives a TanStack Table with controlled pagination.
 *
 * `count` says how the API reports size: `"total"` returns `{ items, total }`; `"probe"` returns
 * a bare array, so one extra row is requested to learn whether a next page exists.
 */
export function useServerList<
  P extends Parsers,
  TRow extends RowData,
  TCount extends "probe" | "total",
>(options: {
  /** nuqs parsers for the list's URL state, including `paginationParsers`. */
  search: P;
  /** Names the list in the query key `["admin", ...key, …]`, e.g. `"orders"` or `["items", id]`. */
  key: string | readonly string[];
  count: TCount;
  fetchPage: (
    page: { limit: number; offset: number },
    filters: Filters<P>,
    signal: AbortSignal,
  ) => Promise<
    TCount extends "total" ? { items: readonly TRow[]; total: number } : readonly TRow[]
  >;
  columns: ColumnDef<typeof dataTableFeatures, TRow, any>[];
  getRowId: (row: TRow) => string;
  emptyMessage: string;
}) {
  const [search, setSearch] = useQueryStates(options.search);
  // Both carry defaults (`paginationParsers`), so they are never null.
  const { page, size, ...rest } = search as unknown as { page: number; size: number };
  const filters = rest as Filters<P>;
  const probe = options.count === "probe";
  const request = { limit: probe ? size + 1 : size, offset: page * size };
  const list = useQuery({
    queryKey: ["admin", ...[options.key].flat(), request, filters],
    queryFn: ({ signal }) => options.fetchPage(request, filters, signal),
    placeholderData: keepPreviousData,
  });

  const result = list.data as
    | { items: readonly TRow[]; total: number }
    | readonly TRow[]
    | undefined;
  const fetched: readonly TRow[] = !result ? noRows : "items" in result ? result.items : result;
  const hasNext = probe && fetched.length > size;
  // Stable rows for the table: a new array each render would rebuild its row model.
  const rows = useMemo(
    () => (hasNext ? fetched.slice(0, size) : fetched) as TRow[],
    [fetched, hasNext, size],
  );
  const pagination = { pageIndex: page, pageSize: size };
  const table = useAppTable({
    columns: options.columns,
    data: rows,
    getRowId: options.getRowId,
    manualPagination: true,
    ...(probe
      ? { pageCount: page + (hasNext ? 2 : 1) }
      : { rowCount: (result as { total: number } | undefined)?.total ?? 0 }),
    state: { pagination },
    onPaginationChange: (updater) =>
      void setSearch(paginationUpdate(pagination, updater) as Partial<Nullable<Values<P>>>),
    meta: { totalKnown: !probe, emptyMessage: options.emptyMessage },
  });

  return {
    table,
    list,
    search: filters,
    /** Changes filters and returns to the first page. */
    setFilter: (next: Partial<Nullable<Filters<P>>>) =>
      void setSearch({ ...next, page: null } as Partial<Nullable<Values<P>>>),
  };
}
