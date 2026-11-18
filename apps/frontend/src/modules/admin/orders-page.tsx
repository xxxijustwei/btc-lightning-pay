import { Input } from "@btc-lightning-pay/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@btc-lightning-pay/ui/components/table";
import { ToggleGroup, ToggleGroupItem } from "@btc-lightning-pay/ui/components/toggle-group";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { adminApi, type PaymentStatusValue } from "../../lib/api/admin";
import {
  beijingDayEnd,
  beijingDayStart,
  formatBeijing,
  formatSats,
  formatUsd,
  shortId,
} from "../../lib/format";
import {
  CopyButton,
  EmptyRow,
  ErrorState,
  ListPagination,
  LoadingRows,
  OrderSettlementBadge,
  OrderStatusBadge,
  orderStatusOptions,
} from "./common";
import { MerchantSelect, useMerchantNames } from "./merchant-select";
import { AdminPage } from "./shell";

export function OrdersPage({
  merchantId,
  onMerchantChange,
}: {
  merchantId: string | undefined;
  onMerchantChange: (merchantId: string | undefined) => void;
}) {
  const [status, setStatus] = useState<PaymentStatusValue | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const names = useMerchantNames();

  const query = {
    // One extra row tells whether a next page exists; the API returns no total.
    limit: pageSize + 1,
    offset: (page - 1) * pageSize,
    merchantId,
    status: status === "all" ? undefined : status,
    from: from ? beijingDayStart(from) : undefined,
    to: to ? beijingDayEnd(to) : undefined,
  };
  const orders = useQuery({
    queryKey: ["admin", "orders", query],
    queryFn: ({ signal }) => adminApi.orders(query, signal),
    placeholderData: keepPreviousData,
  });
  const rows = orders.data?.slice(0, pageSize) ?? [];
  const resetPage = () => setPage(1);

  return (
    <AdminPage
      crumbs={[{ label: "订单" }]}
      title="订单"
      description="状态由后端核实到账后更新；已过期订单若晚到账，仍会更新为已支付并记账。时间为北京时间。"
    >
      <section aria-label="订单列表" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <MerchantSelect
            value={merchantId}
            onChange={(next) => {
              onMerchantChange(next);
              resetPage();
            }}
          />
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            从
            <Input
              type="date"
              aria-label="开始日期（含）"
              className="h-8 w-[150px]"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                resetPage();
              }}
            />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            至
            <Input
              type="date"
              aria-label="结束日期（含）"
              className="h-8 w-[150px]"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                resetPage();
              }}
            />
          </label>
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="支付状态"
            value={[status]}
            onValueChange={(values) => {
              const next = values[0] as PaymentStatusValue | "all" | undefined;
              if (next) {
                setStatus(next);
                resetPage();
              }
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
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead className="pl-4">订单 ID</TableHead>
                  <TableHead>Payment hash</TableHead>
                  <TableHead>商户</TableHead>
                  <TableHead className="text-right">报价 USD</TableHead>
                  <TableHead className="text-right">应收 sats</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>到账时间</TableHead>
                  <TableHead className="pr-4">结算</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.isPending ? (
                  <LoadingRows columns={9} />
                ) : rows.length === 0 ? (
                  <EmptyRow columns={9}>当前筛选条件下没有订单。</EmptyRow>
                ) : (
                  rows.map((order) => {
                    const merchant = names.get(order.merchantId);
                    return (
                      <TableRow key={order.id}>
                        <TableCell className="pl-4 font-mono">
                          <Link
                            to="/orders/$orderId"
                            params={{ orderId: order.id }}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {shortId(order.id)}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {order.paymentHash ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="font-mono text-muted-foreground">
                                {order.paymentHash.slice(0, 8)}…{order.paymentHash.slice(-8)}
                              </span>
                              <CopyButton value={order.paymentHash} label="复制" />
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {merchant ? (
                            <Link
                              to="/merchants/$merchantId"
                              params={{ merchantId: merchant.id }}
                              className="underline-offset-4 hover:underline"
                            >
                              {merchant.name}
                            </Link>
                          ) : (
                            <span className="font-mono text-muted-foreground">
                              {shortId(order.merchantId)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatUsd(order.amountUsdCents)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatSats(order.amountSat)}
                        </TableCell>
                        <TableCell>
                          <OrderStatusBadge status={order.status} />
                        </TableCell>
                        <TableCell className="text-muted-foreground tabular-nums">
                          {formatBeijing(order.createdAt, false)}
                        </TableCell>
                        <TableCell className="text-muted-foreground tabular-nums">
                          {formatBeijing(order.paidAt, false)}
                        </TableCell>
                        <TableCell className="pr-4">
                          <OrderSettlementBadge
                            status={order.settlementStatus}
                            paid={order.status === "paid"}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
        <ListPagination
          page={page}
          pageSize={pageSize}
          hasNext={(orders.data?.length ?? 0) > pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            resetPage();
          }}
        />
      </section>
    </AdminPage>
  );
}
