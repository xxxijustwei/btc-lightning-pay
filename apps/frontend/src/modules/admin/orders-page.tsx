import { ToggleGroup, ToggleGroupItem } from "@btc-lightning-pay/ui/components/toggle-group";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useQueryStates } from "nuqs";
import { DataTable, DataTablePagination } from "../../components/data-table/data-table";
import { createAppColumnHelper, useAppTable } from "../../components/data-table/table-hook";
import { DateRangePicker } from "../../components/date-range-picker";
import { adminApi, type AdminOrderData, type PaymentStatusValue } from "../../lib/api/admin";
import {
  beijingDayEnd,
  beijingDayStart,
  formatBeijing,
  formatSats,
  formatUsd,
  shortId,
} from "../../lib/format";
import { ordersSearch, paginationState, paginationUpdate } from "../../lib/list-search";
import {
  CopyButton,
  ErrorState,
  OrderSettlementBadge,
  OrderStatusBadge,
  orderStatusOptions,
} from "./common";
import { MerchantCell, MerchantSelect } from "./merchant-select";
import { AdminPage } from "./shell";

const helper = createAppColumnHelper<AdminOrderData>();
const columns = helper.columns([
  helper.accessor("id", {
    header: "订单 ID",
    cell: ({ getValue }) => (
      <Link
        to="/orders/$orderId"
        params={{ orderId: getValue() }}
        className="font-mono font-medium underline-offset-4 hover:underline"
      >
        {shortId(getValue())}
      </Link>
    ),
  }),
  helper.accessor("paymentHash", {
    header: "Payment hash",
    cell: ({ getValue }) => {
      const hash = getValue();
      return hash ? (
        <span className="inline-flex items-center gap-1">
          <span className="font-mono text-muted-foreground">
            {hash.slice(0, 8)}…{hash.slice(-8)}
          </span>
          <CopyButton value={hash} />
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
  }),
  helper.accessor("merchantId", {
    header: "商户",
    cell: ({ getValue }) => <MerchantCell merchantId={getValue()} />,
  }),
  helper.accessor("amountUsdCents", {
    header: "报价 USD",
    meta: { headerClassName: "text-right", cellClassName: "text-right tabular-nums" },
    cell: ({ getValue }) => formatUsd(getValue()),
  }),
  helper.accessor("amountSat", {
    header: "应收 sats",
    meta: { headerClassName: "text-right", cellClassName: "text-right font-mono tabular-nums" },
    cell: ({ getValue }) => formatSats(getValue()),
  }),
  helper.accessor("status", {
    header: "状态",
    cell: ({ getValue }) => <OrderStatusBadge status={getValue()} />,
  }),
  helper.accessor("createdAt", {
    header: "创建时间",
    meta: { cellClassName: "text-muted-foreground tabular-nums" },
    cell: ({ getValue }) => formatBeijing(getValue(), false),
  }),
  helper.accessor("paidAt", {
    header: "到账时间",
    meta: { cellClassName: "text-muted-foreground tabular-nums" },
    cell: ({ getValue }) => formatBeijing(getValue(), false),
  }),
  helper.accessor("settlementStatus", {
    header: "结算",
    cell: ({ getValue, row }) => (
      <OrderSettlementBadge status={getValue()} paid={row.original.status === "paid"} />
    ),
  }),
]);
const noRows: AdminOrderData[] = [];

export function OrdersPage() {
  const [search, setSearch] = useQueryStates(ordersSearch);
  const pagination = paginationState(search);
  const query = {
    // One extra row tells whether a next page exists; the API returns no total.
    limit: search.size + 1,
    offset: search.page * search.size,
    merchantId: search.merchantId ?? undefined,
    status: search.status ?? undefined,
    from: search.from ? beijingDayStart(search.from) : undefined,
    to: search.to ? beijingDayEnd(search.to) : undefined,
  };
  const orders = useQuery({
    queryKey: ["admin", "orders", query],
    queryFn: ({ signal }) => adminApi.orders(query, signal),
    placeholderData: keepPreviousData,
  });
  const fetched = orders.data ?? noRows;
  const hasNext = fetched.length > search.size;
  const table = useAppTable({
    columns,
    data: hasNext ? fetched.slice(0, search.size) : fetched,
    getRowId: (order) => order.id,
    manualPagination: true,
    pageCount: search.page + (hasNext ? 2 : 1),
    state: { pagination },
    onPaginationChange: (updater) => void setSearch(paginationUpdate(pagination, updater)),
    meta: { totalKnown: false, emptyMessage: "当前筛选条件下没有订单。" },
  });

  return (
    <AdminPage crumbs={[{ label: "订单" }]} title="订单">
      <table.AppTable>
        <section aria-label="订单列表" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <MerchantSelect
              value={search.merchantId}
              onChange={(merchantId) => void setSearch({ merchantId, page: null })}
            />
            <DateRangePicker
              from={search.from}
              to={search.to}
              onChange={({ from, to }) => void setSearch({ from, to, page: null })}
            />
            <ToggleGroup
              variant="outline"
              size="sm"
              spacing={0}
              aria-label="支付状态"
              value={[search.status ?? "all"]}
              onValueChange={(values) => {
                const next = values[0] as PaymentStatusValue | "all" | undefined;
                if (next) void setSearch({ status: next === "all" ? null : next, page: null });
              }}
            >
              <ToggleGroupItem value="all">全部</ToggleGroupItem>
              {orderStatusOptions.map((option) => (
                <ToggleGroupItem key={option.value} value={option.value}>
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          {orders.isError ? (
            <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
          ) : (
            <DataTable loading={orders.isPending} />
          )}
          <DataTablePagination />
        </section>
      </table.AppTable>
    </AdminPage>
  );
}
