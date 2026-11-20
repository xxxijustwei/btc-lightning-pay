import { Button } from "@btc-lightning-pay/ui/components/button";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { DataTable, DataTablePagination } from "../../components/data-table/data-table";
import { createAppColumnHelper } from "../../components/data-table/table-hook";
import { DateRangePicker } from "../../components/date-range-picker";
import { adminApi, type SettlementData } from "../../lib/api/admin";
import { formatBeijing, formatSats, shortId } from "../../lib/format";
import { beijingRange, settlementsSearch } from "../../lib/list-search";
import { ErrorState, SettlementStatusBadge, settlementStatusOptions } from "./common";
import { FilterToggle } from "./filter-toggle";
import { MerchantCell, MerchantSelect } from "./merchant-select";
import { useServerList } from "./server-list";
import { AdminPage } from "./shell";

const helper = createAppColumnHelper<SettlementData>();
export const settlementColumns = helper.columns([
  helper.accessor("id", {
    header: "编号",
    cell: ({ getValue }) => (
      <Link
        to="/settlements/$settlementId"
        params={{ settlementId: getValue() }}
        className="font-mono font-medium underline-offset-4 hover:underline"
      >
        {shortId(getValue())}
      </Link>
    ),
  }),
  helper.accessor("merchantId", {
    header: "商户",
    cell: ({ getValue }) => <MerchantCell merchantId={getValue()} />,
  }),
  helper.accessor("status", {
    header: "状态",
    cell: ({ getValue }) => <SettlementStatusBadge status={getValue()} />,
  }),
  helper.accessor("amountSat", {
    header: "应付 (sats)",
    meta: { headerClassName: "text-right", cellClassName: "text-right font-mono tabular-nums" },
    cell: ({ getValue, row }) => (
      <span className={row.original.status === "cancelled" ? "text-muted-foreground" : undefined}>
        {formatSats(getValue())}
      </span>
    ),
  }),
  helper.accessor("orderCount", { header: "笔数", cell: ({ getValue }) => `${getValue()} 笔` }),
  helper.accessor("cutoffAt", {
    header: "截止时间",
    meta: { cellClassName: "text-muted-foreground tabular-nums" },
    cell: ({ getValue }) => formatBeijing(getValue()),
  }),
  helper.accessor("createdAt", {
    header: "生成时间",
    meta: { cellClassName: "text-muted-foreground tabular-nums" },
    cell: ({ getValue }) => formatBeijing(getValue(), false),
  }),
  helper.display({
    id: "actions",
    header: () => <span className="sr-only">操作</span>,
    meta: { headerClassName: "text-right", cellClassName: "text-right" },
    cell: ({ row }) => {
      const pending = row.original.status === "pending";
      return (
        <Button
          variant={pending ? "outline" : "ghost"}
          size="sm"
          nativeButton={false}
          render={
            <Link to="/settlements/$settlementId" params={{ settlementId: row.original.id }} />
          }
        >
          {pending ? "去确认付款" : "查看"}
        </Button>
      );
    },
  }),
]);

export function SettlementsPage() {
  const { table, list, search, setFilter } = useServerList({
    search: settlementsSearch,
    key: "settlements",
    count: "total",
    fetchPage: (page, filters, signal) =>
      adminApi.settlements(
        {
          query: {
            ...page,
            merchantId: filters.merchantId ?? undefined,
            status: filters.status ?? undefined,
            ...beijingRange(filters),
          },
        },
        { signal },
      ),
    columns: settlementColumns,
    getRowId: (settlement) => settlement.id,
    emptyMessage: "当前筛选条件下没有结算单。",
  });

  return (
    <AdminPage
      crumbs={[{ label: "结算单" }]}
      title="结算单"
      actions={
        <Button nativeButton={false} render={<Link to="/merchants" />}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          选择商户生成
        </Button>
      }
    >
      <table.AppTable>
        <section aria-label="结算单列表" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <MerchantSelect
              value={search.merchantId}
              onChange={(merchantId) => setFilter({ merchantId })}
            />
            <DateRangePicker
              label="生成时间"
              showLabel
              from={search.from}
              to={search.to}
              onChange={({ from, to }) => setFilter({ from, to })}
            />
            <FilterToggle
              label="状态"
              options={settlementStatusOptions}
              value={search.status}
              onChange={(status) => setFilter({ status })}
            />
          </div>
          {list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : (
            <DataTable loading={list.isPending} />
          )}
          <DataTablePagination />
        </section>
      </table.AppTable>
    </AdminPage>
  );
}
