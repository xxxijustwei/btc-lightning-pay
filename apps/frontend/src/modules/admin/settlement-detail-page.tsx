import { Alert, AlertDescription, AlertTitle } from "@btc-lightning-pay/ui/components/alert";
import { Button } from "@btc-lightning-pay/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@btc-lightning-pay/ui/components/card";
import { FieldGroup } from "@btc-lightning-pay/ui/components/field";
import { Skeleton } from "@btc-lightning-pay/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, CircleAlert } from "lucide-react";
import { useQueryStates } from "nuqs";
import { useMemo, useState } from "react";
import { DataTable, DataTablePagination } from "../../components/data-table/data-table";
import { createAppColumnHelper, useAppTable } from "../../components/data-table/table-hook";
import { adminApi, type SettlementData } from "../../lib/api/admin";
import { formatBeijing, formatSats, shortId } from "../../lib/format";
import { paginationParsers, paginationState, paginationUpdate } from "../../lib/list-search";
import { validateProof, validateReason } from "../../lib/validation";
import { Detail, ErrorState, SettlementStatusBadge } from "./common";
import { FormDialog } from "./form-dialog";
import { useMerchantNames } from "./merchant-select";
import { allAdminsQuery, settlementOrdersQuery, settlementQuery } from "./queries";
import { AdminPage } from "./shell";
import { useWriteDialog } from "./write-dialog";

export function SettlementDetailPage({ settlementId }: { settlementId: string }) {
  const settlement = useQuery(settlementQuery(settlementId));
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

type SettlementItem = Awaited<ReturnType<typeof adminApi.settlementOrders>>["items"][number];
const itemHelper = createAppColumnHelper<SettlementItem>();
const noItems: SettlementItem[] = [];

function SettlementItems({ settlement }: { settlement: SettlementData }) {
  const [search, setSearch] = useQueryStates(paginationParsers);
  const pagination = paginationState(search);
  const query = { limit: search.size, offset: search.page * search.size };
  const items = useQuery(settlementOrdersQuery(settlement.id, query));
  const columns = useMemo(
    () =>
      itemHelper.columns([
        itemHelper.accessor("orderId", {
          header: "订单 ID",
          meta: { cellClassName: "font-mono" },
          cell: ({ getValue }) => (
            <Link
              to="/orders/$orderId"
              params={{ orderId: getValue() }}
              className="underline-offset-4 hover:underline"
            >
              {getValue()}
            </Link>
          ),
          footer: "合计（整张结算单）",
        }),
        itemHelper.accessor("amountSat", {
          header: "应付 (sats)",
          meta: {
            headerClassName: "text-right",
            cellClassName: "text-right font-mono tabular-nums",
          },
          cell: ({ getValue }) => formatSats(getValue()),
          footer: () => formatSats(settlement.amountSat),
        }),
      ]),
    [settlement.amountSat],
  );
  const table = useAppTable({
    columns,
    data: items.data?.items ?? noItems,
    getRowId: (item) => item.orderId,
    manualPagination: true,
    rowCount: items.data?.total ?? settlement.orderCount,
    state: { pagination },
    onPaginationChange: (updater) => void setSearch(paginationUpdate(pagination, updater)),
    meta: { emptyMessage: "没有订单。" },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>订单明细</CardTitle>
        <CardDescription>生成后固定，不随新到账变化。</CardDescription>
      </CardHeader>
      <CardContent>
        <table.AppTable>
          <div className="flex flex-col gap-3">
            {items.isError ? (
              <ErrorState error={items.error} onRetry={() => void items.refetch()} />
            ) : (
              <DataTable loading={items.isPending} />
            )}
            <DataTablePagination />
          </div>
        </table.AppTable>
      </CardContent>
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
  const { form, dialogProps } = useWriteDialog({
    defaultValues: { proof: "", paid: false },
    mutationFn: (value) =>
      adminApi.confirmSettlement({
        params: { settlementId: settlement.id },
        payload: { proof: value.proof.trim() },
      }),
    toast: (settled) => ({
      title: "结算单已确认付款",
      description: `${formatSats(settled.amountSat)} sats 计入已结算`,
    }),
    onClose,
  });
  return (
    <FormDialog
      {...dialogProps}
      open={open}
      title="确认已付款"
      description="确认后计入已结算，不能取消、修改凭证或删除。"
      submitLabel="确认已付款"
    >
      <FieldGroup>
        <form.AppField name="proof" validators={{ onBlur: validateProof, onSubmit: validateProof }}>
          {(field) => (
            <field.TextareaField
              label="转账凭证"
              rows={3}
              maxLength={1000}
              placeholder="payment hash、交易记录号或备注"
              description={(value) => `${value.length} / 1000`}
            />
          )}
        </form.AppField>
        <form.AppField
          name="paid"
          validators={{
            onSubmit: ({ value }) => (value ? undefined : "请确认已实际完成转账。"),
          }}
        >
          {(field) => (
            <field.CheckboxField
              label={
                <>
                  我确认已向{merchantName ? ` ${merchantName} ` : "商户"}实际转账{" "}
                  {formatSats(settlement.amountSat)} sats。
                </>
              }
            />
          )}
        </form.AppField>
      </FieldGroup>
    </FormDialog>
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
  const { form, dialogProps } = useWriteDialog({
    defaultValues: { reason: "" },
    mutationFn: (value) =>
      adminApi.cancelSettlement({
        params: { settlementId: settlement.id },
        payload: { reason: value.reason.trim() },
      }),
    toast: (cancelled) => ({
      title: "结算单已取消",
      description: `${cancelled.orderCount} 笔订单已释放`,
    }),
    onClose,
  });
  return (
    <FormDialog
      {...dialogProps}
      open={open}
      title="取消结算单"
      description={`仅在确认尚未付款时取消。取消后 ${settlement.orderCount} 笔订单释放，可进入新的结算单；本单明细保留。`}
      submitLabel="取消结算单"
      destructive
    >
      <form.AppField
        name="reason"
        validators={{ onBlur: validateReason, onSubmit: validateReason }}
      >
        {(field) => (
          <field.TextareaField
            label="取消原因"
            rows={3}
            maxLength={500}
            placeholder="例如：尚未付款，重新核对"
          />
        )}
      </form.AppField>
    </FormDialog>
  );
}
