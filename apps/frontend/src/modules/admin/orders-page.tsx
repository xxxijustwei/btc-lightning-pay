import { Link } from "@tanstack/react-router";
import { DataTable, DataTablePagination } from "../../components/data-table/data-table";
import { createAppColumnHelper } from "../../components/data-table/table-hook";
import { DateRangePicker } from "../../components/date-range-picker";
import { adminApi, type AdminOrderData } from "../../lib/api/admin";
import { formatBeijing, formatUsd, shortId } from "../../lib/format";
import { beijingRange, ordersSearch } from "../../lib/list-search";
import {
  Amount,
  satsLabel,
  CopyButton,
  ErrorState,
  OrderSettlementBadge,
  OrderStatusBadge,
  orderStatusOptions,
} from "./common";
import { FilterToggle } from "./filter-toggle";
import { MerchantCell, MerchantSelect } from "./merchant-select";
import { useServerList } from "./server-list";
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
    header: "金额",
    meta: { headerClassName: "text-right", cellClassName: "text-right" },
    cell: ({ row }) => (
      <Amount
        align="end"
        main={formatUsd(row.original.amountUsdCents)}
        sub={satsLabel(row.original.amountSat)}
      />
    ),
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
export function OrdersPage() {
  const { table, list, search, setFilter } = useServerList({
    search: ordersSearch,
    key: "orders",
    // The orders API returns a bare array, so the list probes for a next page.
    count: "probe",
    fetchPage: (page, filters, signal) =>
      adminApi.orders(
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
    columns,
    getRowId: (order) => order.id,
    emptyMessage: "当前筛选条件下没有订单。",
  });

  return (
    <AdminPage crumbs={[{ label: "订单" }]} title="订单">
      <table.AppTable>
        <section aria-label="订单列表" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <MerchantSelect
              value={search.merchantId}
              onChange={(merchantId) => setFilter({ merchantId })}
            />
            <DateRangePicker
              from={search.from}
              to={search.to}
              onChange={({ from, to }) => setFilter({ from, to })}
            />
            <FilterToggle
              label="支付状态"
              options={orderStatusOptions}
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
