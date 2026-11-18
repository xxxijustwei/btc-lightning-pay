import { Button } from "@btc-lightning-pay/ui/components/button";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "@btc-lightning-pay/ui/components/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@btc-lightning-pay/ui/components/select";
import { Skeleton } from "@btc-lightning-pay/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@btc-lightning-pay/ui/components/table";
import { cn } from "@btc-lightning-pay/ui/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_SIZES } from "../../lib/list-search";
import { useTableContext } from "./table-hook";

/** shadcn data table body for the table provided by `<table.AppTable>`. */
export function DataTable({ loading, className }: { loading?: boolean; className?: string }) {
  const table = useTableContext();
  const columns = table.getVisibleLeafColumns();
  const hasFooter = columns.some((column) => column.columnDef.footer);
  const rows = table.getRowModel().rows;
  return (
    <div className={cn("overflow-hidden rounded-lg border", className)}>
      <Table>
        <TableHeader className="bg-muted">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead
                  key={header.id}
                  colSpan={header.colSpan}
                  className={cn(
                    "first:pl-4 last:pr-4",
                    header.column.columnDef.meta?.headerClassName,
                  )}
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: 5 }, (_, index) => (
              <TableRow key={index}>
                {columns.map((column) => (
                  <TableCell key={column.id} className="first:pl-4 last:pr-4">
                    <Skeleton className="h-4 w-full max-w-32" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length ? (
            rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      "first:pl-4 last:pr-4",
                      cell.column.columnDef.meta?.cellClassName,
                    )}
                  >
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-muted-foreground"
              >
                {table.options.meta?.emptyMessage ?? "没有数据。"}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {hasFooter ? (
          <TableFooter>
            {table.getFooterGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableCell
                    key={header.id}
                    colSpan={header.colSpan}
                    className={cn(
                      "first:pl-4 last:pr-4",
                      header.column.columnDef.meta?.cellClassName,
                    )}
                  >
                    {header.isPlaceholder ? null : <table.FlexRender footer={header} />}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableFooter>
        ) : null}
      </Table>
    </div>
  );
}

function pageNumbers(page: number, count: number): (number | "…")[] {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, "…", count];
  if (page >= count - 3) return [1, "…", count - 4, count - 3, count - 2, count - 1, count];
  return [1, "…", page - 1, page, page + 1, "…", count];
}

/**
 * shadcn pagination footer driven by the table's pagination state. With an unknown total
 * (APIs returning bare arrays) it shows the current page and trusts `getCanNextPage`.
 */
export function DataTablePagination() {
  const table = useTableContext();
  const { pageIndex, pageSize } = table.state.pagination;
  const page = pageIndex + 1;
  const totalKnown = table.options.meta?.totalKnown !== false;
  const count = Math.max(1, table.getPageCount());
  const numbers = totalKnown ? pageNumbers(page, count) : [page];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground">
        {totalKnown ? `共 ${table.getRowCount()} 条 · 第 ${page} / ${count} 页` : `第 ${page} 页`}
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span id="page-size-label" className="font-medium whitespace-nowrap">
            每页行数
          </span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => value && table.setPageSize(Number(value))}
            items={PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
          >
            <SelectTrigger size="sm" className="w-[72px]" aria-labelledby="page-size-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Pagination className="mx-0 w-auto">
          <PaginationContent>
            <PaginationItem>
              <Button
                variant="ghost"
                className="pl-2"
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
              >
                <ChevronLeft data-icon="inline-start" aria-hidden="true" />
                上一页
              </Button>
            </PaginationItem>
            {numbers.map((value, index) =>
              value === "…" ? (
                <PaginationItem key={`gap-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={value}>
                  <Button
                    variant={value === page ? "outline" : "ghost"}
                    size="icon"
                    aria-current={value === page ? "page" : undefined}
                    aria-label={`第 ${value} 页`}
                    onClick={() => table.setPageIndex(value - 1)}
                  >
                    {value}
                  </Button>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              <Button
                variant="ghost"
                className="pr-2"
                disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()}
              >
                下一页
                <ChevronRight data-icon="inline-end" aria-hidden="true" />
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}
