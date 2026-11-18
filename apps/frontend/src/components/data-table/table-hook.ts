import {
  columnVisibilityFeature,
  createPaginatedRowModel,
  createTableHook,
  rowPaginationFeature,
  tableFeatures,
} from "@tanstack/react-table";

/**
 * Shared TanStack Table setup for every admin list. Lists paginate on the server
 * (`manualPagination`); the paginated row model only serves the small client-side list.
 * Column visibility lets a page reuse another page's columns with some hidden.
 */
export const dataTableFeatures = tableFeatures({
  rowPaginationFeature,
  columnVisibilityFeature,
  paginatedRowModel: createPaginatedRowModel(),
  columnMeta: {} as { headerClassName?: string; cellClassName?: string },
  tableMeta: {} as {
    /** False when the API returns no total; the footer then shows only the current page. */
    totalKnown?: boolean;
    emptyMessage?: string;
  },
});

export const { createAppColumnHelper, useAppTable, useTableContext } = createTableHook({
  features: dataTableFeatures,
});
