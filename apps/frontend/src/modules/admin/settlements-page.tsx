import { Button } from "@btc-lightning-pay/ui/components/button";
import { ToggleGroup, ToggleGroupItem } from "@btc-lightning-pay/ui/components/toggle-group";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useQueryStates } from "nuqs";
import { DataTable, DataTablePagination } from "../../components/data-table/data-table";
import { createAppColumnHelper, useAppTable } from "../../components/data-table/table-hook";
import { DateRangePicker } from "../../components/date-range-picker";
import { adminApi, type SettlementData, type SettlementStatusValue } from "../../lib/api/admin";
import {
  beijingDayEnd,
  beijingDayStart,
  formatBeijing,
  formatSats,
  shortId,
} from "../../lib/format";
import { paginationState, paginationUpdate, settlementsSearch } from "../../lib/list-search";
import { ErrorState, SettlementStatusBadge, settlementStatusOptions } from "./common";
import { MerchantCell, MerchantSelect } from "./merchant-select";
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
const noRows: SettlementData[] = [];

export function SettlementsPage() {
  const [search, setSearch] = useQueryStates(settlementsSearch);
  const pagination = paginationState(search);
  const query = {
    limit: search.size,
    offset: search.page * search.size,
    merchantId: search.merchantId ?? undefined,
    status: search.status ?? undefined,
    from: search.from ? beijingDayStart(search.from) : undefined,
    to: search.to ? beijingDayEnd(search.to) : undefined,
  };
  const settlements = useQuery({
    queryKey: ["admin", "settlements", query],
    queryFn: ({ signal }) => adminApi.settlements({ query }, { signal }),
    placeholderData: keepPreviousData,
  });
  const table = useAppTable({
    columns: settlementColumns,
    data: settlements.data?.items ?? noRows,
    getRowId: (settlement) => settlement.id,
    manualPagination: true,
    rowCount: settlements.data?.total ?? 0,
    state: { pagination },
    onPaginationChange: (updater) => void setSearch(paginationUpdate(pagination, updater)),
    meta: { emptyMessage: "当前筛选条件下没有结算单。" },
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
              onChange={(merchantId) => void setSearch({ merchantId, page: null })}
            />
            <DateRangePicker
              label="生成时间"
              showLabel
              from={search.from}
              to={search.to}
              onChange={({ from, to }) => void setSearch({ from, to, page: null })}
            />
            <ToggleGroup
              variant="outline"
              size="sm"
              spacing={0}
              aria-label="状态"
              value={[search.status ?? "all"]}
              onValueChange={(values) => {
                const next = values[0] as SettlementStatusValue | "all" | undefined;
                if (next) void setSearch({ status: next === "all" ? null : next, page: null });
              }}
            >
              <ToggleGroupItem value="all">全部</ToggleGroupItem>
              {settlementStatusOptions.map((option) => (
                <ToggleGroupItem key={option.value} value={option.value}>
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          {settlements.isError ? (
            <ErrorState error={settlements.error} onRetry={() => void settlements.refetch()} />
          ) : (
            <DataTable loading={settlements.isPending} />
          )}
          <DataTablePagination />
        </section>
      </table.AppTable>
    </AdminPage>
  );
}
