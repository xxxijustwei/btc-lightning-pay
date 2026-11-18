import { Button } from "@btc-lightning-pay/ui/components/button";
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
import { Plus } from "lucide-react";
import { useState } from "react";
import { adminApi, type SettlementStatusValue } from "../../lib/api/admin";
import { formatBeijing, formatSats, shortId } from "../../lib/format";
import {
  EmptyRow,
  ErrorState,
  ListPagination,
  LoadingRows,
  SettlementStatusBadge,
  settlementStatusOptions,
} from "./common";
import { MerchantSelect, useMerchantNames } from "./merchant-select";
import { AdminPage } from "./shell";

export function SettlementsPage({
  merchantId,
  onMerchantChange,
}: {
  merchantId: string | undefined;
  onMerchantChange: (merchantId: string | undefined) => void;
}) {
  const [status, setStatus] = useState<SettlementStatusValue | "all">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const names = useMerchantNames();
  const query = {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    merchantId,
    status: status === "all" ? undefined : status,
  };
  const settlements = useQuery({
    queryKey: ["admin", "settlements", query],
    queryFn: ({ signal }) => adminApi.settlements(query, signal),
    placeholderData: keepPreviousData,
  });

  return (
    <AdminPage
      crumbs={[{ label: "结算单" }]}
      title="结算单"
      description="生成 → 线下转账 → 填凭证确认。系统不执行转账；时间均为北京时间。"
      actions={
        <Button nativeButton={false} render={<Link to="/merchants" />}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          选择商户生成
        </Button>
      }
    >
      <section aria-label="结算单列表" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <MerchantSelect
            value={merchantId}
            onChange={(next) => {
              onMerchantChange(next);
              setPage(1);
            }}
          />
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="状态"
            value={[status]}
            onValueChange={(values) => {
              const next = values[0] as SettlementStatusValue | "all" | undefined;
              if (next) {
                setStatus(next);
                setPage(1);
              }
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
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead className="pl-4">编号</TableHead>
                  <TableHead>商户</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">应付 (sats)</TableHead>
                  <TableHead>笔数</TableHead>
                  <TableHead>截止时间</TableHead>
                  <TableHead>生成时间</TableHead>
                  <TableHead className="pr-4 text-right">
                    <span className="sr-only">操作</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settlements.isPending ? (
                  <LoadingRows columns={8} />
                ) : settlements.data.items.length === 0 ? (
                  <EmptyRow columns={8}>当前筛选条件下没有结算单。</EmptyRow>
                ) : (
                  settlements.data.items.map((settlement) => {
                    const merchant = names.get(settlement.merchantId);
                    return (
                      <TableRow key={settlement.id}>
                        <TableCell className="pl-4 font-mono">
                          <Link
                            to="/settlements/$settlementId"
                            params={{ settlementId: settlement.id }}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {shortId(settlement.id)}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {merchant?.name ?? (
                            <span className="font-mono">{shortId(settlement.merchantId)}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <SettlementStatusBadge status={settlement.status} />
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono tabular-nums ${
                            settlement.status === "cancelled" ? "text-muted-foreground" : ""
                          }`}
                        >
                          {formatSats(settlement.amountSat)}
                        </TableCell>
                        <TableCell>{settlement.orderCount} 笔</TableCell>
                        <TableCell className="text-muted-foreground tabular-nums">
                          {formatBeijing(settlement.cutoffAt)}
                        </TableCell>
                        <TableCell className="text-muted-foreground tabular-nums">
                          {formatBeijing(settlement.createdAt, false)}
                        </TableCell>
                        <TableCell className="pr-4 text-right">
                          <Button
                            variant={settlement.status === "pending" ? "outline" : "ghost"}
                            size="sm"
                            nativeButton={false}
                            render={
                              <Link
                                to="/settlements/$settlementId"
                                params={{ settlementId: settlement.id }}
                              />
                            }
                          >
                            {settlement.status === "pending" ? "去确认付款" : "查看"}
                          </Button>
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
          total={settlements.data?.total ?? 0}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </section>
    </AdminPage>
  );
}
