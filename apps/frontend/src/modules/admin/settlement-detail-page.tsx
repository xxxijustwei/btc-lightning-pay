import { Alert, AlertDescription, AlertTitle } from "@btc-lightning-pay/ui/components/alert";
import { Button } from "@btc-lightning-pay/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@btc-lightning-pay/ui/components/card";
import { Checkbox } from "@btc-lightning-pay/ui/components/checkbox";
import { Field, FieldDescription, FieldLabel } from "@btc-lightning-pay/ui/components/field";
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
import { Textarea } from "@btc-lightning-pay/ui/components/textarea";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, CircleAlert } from "lucide-react";
import { useState } from "react";
import { adminApi, describeAdminError, type SettlementData } from "../../lib/api/admin";
import { formatBeijing, formatSats, shortId } from "../../lib/format";
import {
  ConfirmDialog,
  Detail,
  EmptyRow,
  ErrorState,
  ListPagination,
  LoadingRows,
  SettlementStatusBadge,
} from "./common";
import { useMerchantNames } from "./merchant-select";
import { allAdminsQuery } from "./queries";
import { AdminPage } from "./shell";

export function SettlementDetailPage({ settlementId }: { settlementId: string }) {
  const settlement = useQuery({
    queryKey: ["admin", "settlement", settlementId],
    queryFn: ({ signal }) => adminApi.settlement(settlementId, signal),
  });
  const names = useMerchantNames();
  const admins = useQuery(allAdminsQuery());
  const adminName = (id: string | null) =>
    id ? (admins.data?.find((admin) => admin.id === id)?.name ?? shortId(id)) : "—";
  const [dialog, setDialog] = useState<"confirm" | "cancel" | null>(null);
  const crumbs = [{ label: "结算单", to: "/settlements" }, { label: shortId(settlementId) }];

  if (settlement.isPending) {
    return (
      <AdminPage crumbs={crumbs}>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
      </AdminPage>
    );
  }
  if (settlement.isError) {
    return (
      <AdminPage crumbs={crumbs}>
        <ErrorState error={settlement.error} onRetry={() => void settlement.refetch()} />
      </AdminPage>
    );
  }
  const data = settlement.data;
  const merchant = names.get(data.merchantId);
  const pending = data.status === "pending";

  return (
    <AdminPage
      crumbs={crumbs}
      title={
        <>
          <h1 className="text-2xl font-semibold tracking-tight">结算单</h1>
          <SettlementStatusBadge status={data.status} />
        </>
      }
      description={<span className="font-mono break-all">{data.id}</span>}
      actions={
        pending ? (
          <>
            <Button variant="outline" onClick={() => setDialog("cancel")}>
              取消结算单
            </Button>
            <Button onClick={() => setDialog("confirm")}>
              <Check data-icon="inline-start" aria-hidden="true" />
              确认已付款
            </Button>
          </>
        ) : null
      }
    >
      {pending ? (
        <Alert>
          <CircleAlert aria-hidden="true" />
          <AlertTitle>请按应付金额在外部钱包转账，完成后再确认</AlertTitle>
          <AlertDescription>
            系统不会执行转账。转账结果不明时保持待付款，先核实，不要取消或再次付款。
          </AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>结算信息</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-6 gap-y-4">
            <Detail label="应付金额">
              <span className="text-2xl font-semibold tabular-nums">
                {formatSats(data.amountSat)}{" "}
                <span className="text-sm font-normal text-muted-foreground">sats</span>
              </span>
            </Detail>
            <Detail label="商户">
              {merchant ? (
                <>
                  <Link
                    to="/merchants/$merchantId"
                    params={{ merchantId: merchant.id }}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {merchant.name}
                  </Link>{" "}
                  <span className="font-mono text-muted-foreground">/{merchant.slug}</span>
                </>
              ) : (
                <span className="font-mono">{data.merchantId}</span>
              )}
            </Detail>
            <Detail label="订单笔数">{data.orderCount} 笔</Detail>
            <Detail label="截止时间（北京时间）">{formatBeijing(data.cutoffAt)}</Detail>
            <Detail label="生成">
              {adminName(data.createdBy)} · {formatBeijing(data.createdAt, false)}
            </Detail>
          </dl>
          {data.status === "settled" ? (
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-6 gap-y-4 border-t pt-5">
              <Detail label="确认付款">
                {adminName(data.confirmedBy)} · {formatBeijing(data.confirmedAt, false)}
              </Detail>
              <Detail label="转账凭证" wide>
                <span className="block rounded-md bg-muted px-3 py-2.5">{data.proof}</span>
              </Detail>
            </dl>
          ) : null}
          {data.status === "cancelled" ? (
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-6 gap-y-4 border-t pt-5">
              <Detail label="取消">
                {adminName(data.cancelledBy)} · {formatBeijing(data.cancelledAt, false)}
              </Detail>
              <Detail label="取消原因" wide>
                {data.cancelReason}{" "}
                <span className="text-muted-foreground">订单已释放，可进入新的结算单。</span>
              </Detail>
            </dl>
          ) : null}
        </CardContent>
      </Card>
      <SettlementItems settlement={data} />
      <ConfirmPaidDialog
        settlement={data}
        open={dialog === "confirm"}
        onClose={() => setDialog(null)}
        merchantName={merchant?.name}
      />
      <CancelDialog settlement={data} open={dialog === "cancel"} onClose={() => setDialog(null)} />
    </AdminPage>
  );
}

function SettlementItems({ settlement }: { settlement: SettlementData }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const query = { limit: pageSize, offset: (page - 1) * pageSize };
  const items = useQuery({
    queryKey: ["admin", "settlement-orders", settlement.id, query],
    queryFn: ({ signal }) => adminApi.settlementOrders(settlement.id, query, signal),
    placeholderData: keepPreviousData,
  });
  return (
    <Card className="gap-0 pb-0">
      <CardHeader className="pb-4">
        <CardTitle>订单明细</CardTitle>
        <CardDescription>生成后固定，不随新到账变化。</CardDescription>
      </CardHeader>
      {items.isError ? (
        <div className="p-6">
          <ErrorState error={items.error} onRetry={() => void items.refetch()} />
        </div>
      ) : (
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead className="pl-6">订单 ID</TableHead>
              <TableHead className="pr-6 text-right">应付 (sats)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.isPending ? (
              <LoadingRows columns={2} rows={4} />
            ) : items.data.items.length === 0 ? (
              <EmptyRow columns={2}>没有订单。</EmptyRow>
            ) : (
              items.data.items.map((item) => (
                <TableRow key={item.orderId}>
                  <TableCell className="pl-6 font-mono">
                    <Link
                      to="/orders/$orderId"
                      params={{ orderId: item.orderId }}
                      className="underline-offset-4 hover:underline"
                    >
                      {item.orderId}
                    </Link>
                  </TableCell>
                  <TableCell className="pr-6 text-right font-mono tabular-nums">
                    {formatSats(item.amountSat)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="pl-6">合计（整张结算单）</TableCell>
              <TableCell className="pr-6 text-right font-mono tabular-nums">
                {formatSats(settlement.amountSat)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
      <div className="border-t px-6 py-3">
        <ListPagination
          page={page}
          pageSize={pageSize}
          total={items.data?.total ?? settlement.orderCount}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </div>
    </Card>
  );
}

function ConfirmPaidDialog({
  settlement,
  open,
  onClose,
  merchantName,
}: {
  settlement: SettlementData;
  open: boolean;
  onClose: () => void;
  merchantName?: string;
}) {
  const queryClient = useQueryClient();
  const [proof, setProof] = useState("");
  const [paid, setPaid] = useState(false);
  const confirm = useMutation({
    mutationFn: (value: string) => adminApi.confirmSettlement(settlement.id, value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      close();
    },
  });
  function close() {
    setProof("");
    setPaid(false);
    confirm.reset();
    onClose();
  }
  const value = proof.trim();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title="确认已付款"
      description="确认后计入已结算，不能取消、修改凭证或删除。"
      confirmLabel="确认已付款"
      pending={confirm.isPending}
      confirmDisabled={!value || value.length > 1000 || !paid}
      error={confirm.isError ? describeAdminError(confirm.error) : undefined}
      onConfirm={() => confirm.mutate(value)}
    >
      <Field>
        <FieldLabel htmlFor="settlement-proof">转账凭证</FieldLabel>
        <Textarea
          id="settlement-proof"
          rows={3}
          maxLength={1000}
          placeholder="payment hash、交易记录号或备注"
          value={proof}
          onChange={(event) => setProof(event.target.value)}
        />
        <FieldDescription>{proof.length} / 1000</FieldDescription>
      </Field>
      <Field orientation="horizontal">
        <Checkbox
          id="settlement-paid"
          checked={paid}
          onCheckedChange={(checked) => setPaid(checked === true)}
        />
        <FieldLabel htmlFor="settlement-paid" className="font-normal">
          我确认已向{merchantName ? ` ${merchantName} ` : "商户"}实际转账{" "}
          {formatSats(settlement.amountSat)} sats。
        </FieldLabel>
      </Field>
    </ConfirmDialog>
  );
}

function CancelDialog({
  settlement,
  open,
  onClose,
}: {
  settlement: SettlementData;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const cancel = useMutation({
    mutationFn: (value: string) => adminApi.cancelSettlement(settlement.id, value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      close();
    },
  });
  function close() {
    setReason("");
    cancel.reset();
    onClose();
  }
  const value = reason.trim();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title="取消结算单"
      description={`仅在确认尚未付款时取消。取消后 ${settlement.orderCount} 笔订单释放，可进入新的结算单；本单明细保留。`}
      confirmLabel="取消结算单"
      destructive
      pending={cancel.isPending}
      confirmDisabled={!value || value.length > 500}
      error={cancel.isError ? describeAdminError(cancel.error) : undefined}
      onConfirm={() => cancel.mutate(value)}
    >
      <Field>
        <FieldLabel htmlFor="settlement-reason">取消原因</FieldLabel>
        <Textarea
          id="settlement-reason"
          rows={3}
          maxLength={500}
          placeholder="例如：尚未付款，重新核对"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
    </ConfirmDialog>
  );
}
