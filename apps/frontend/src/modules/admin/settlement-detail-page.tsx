import { Alert, AlertDescription, AlertTitle } from "@btc-lightning-pay/ui/components/alert";
import { Button } from "@btc-lightning-pay/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@btc-lightning-pay/ui/components/card";
import { Skeleton } from "@btc-lightning-pay/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleAlert, ExternalLink, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { DataTable, DataTablePagination } from "../../components/data-table/data-table";
import { createAppColumnHelper } from "../../components/data-table/table-hook";
import { adminApi, type PayoutData, type SettlementDetailData } from "../../lib/api/admin";
import { formatBeijing, formatSats, shortId } from "../../lib/format";
import { paginationParsers } from "../../lib/list-search";
import { explorerLink, formatTokenUnits, networkName } from "../../lib/payout";
import { validateNotSentReason, validateReason } from "../../lib/validation";
import {
  CopyButton,
  Detail,
  ErrorState,
  PayoutStatusBadge,
  SettlementStatusBadge,
  UsdApprox,
} from "./common";
import { FormDialog } from "./form-dialog";
import { useMerchantNames } from "./merchant-select";
import { formatCountdown, PayoutDialog, useSecondsLeft } from "./payout-dialog";
import { allAdminsQuery, settlementQuery } from "./queries";
import { useServerList } from "./server-list";
import { AdminPage } from "./shell";
import { useWriteDialog } from "./write-dialog";

export function SettlementDetailPage({ settlementId }: { settlementId: string }) {
  const settlement = useQuery({
    ...settlementQuery(settlementId),
    // While a payout is under way, follow it until it ends.
    refetchInterval: (query) =>
      ["paying", "unconfirmed"].includes(query.state.data?.displayStatus ?? "") ? 10_000 : false,
  });
  const names = useMerchantNames();
  const admins = useQuery(allAdminsQuery());
  const adminName = (id: string | null) =>
    id ? (admins.data?.find((admin) => admin.id === id)?.name ?? shortId(id)) : "—";
  const [dialog, setDialog] = useState<"payout" | "cancel" | null>(null);
  const [notSent, setNotSent] = useState<PayoutData | null>(null);
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
  const payable = data.displayStatus === "pending";
  const quoted = data.payouts.find(
    (payout) => payout.status === "quoted" && Date.parse(payout.quoteExpiresAt) > Date.now(),
  );
  const completed = data.payouts.find((payout) => payout.status === "completed");

  return (
    <AdminPage
      crumbs={crumbs}
      title={
        <>
          <h1 className="text-2xl font-semibold tracking-tight">结算单</h1>
          <SettlementStatusBadge status={data.displayStatus} />
        </>
      }
      description={<span className="font-mono break-all">{data.id}</span>}
      actions={
        payable ? (
          <>
            <Button variant="outline" onClick={() => setDialog("cancel")}>
              取消结算单
            </Button>
            <Button onClick={() => setDialog("payout")}>
              <Send data-icon="inline-start" aria-hidden="true" />
              {quoted ? "继续打款" : "打款"}
            </Button>
          </>
        ) : null
      }
    >
      {data.displayStatus === "unconfirmed" ? (
        <Alert className="border-warning bg-warning/40">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>打款结果待确认</AlertTitle>
          <AlertDescription>
            钱包未及时响应，系统正在核实。请勿重新打款，确认没有转出后再标记为未发出。
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
              {data.status === "pending" ? (
                <UsdApprox
                  sats={data.amountSat}
                  className="block font-medium text-muted-foreground tabular-nums"
                />
              ) : null}
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
              <Detail
                label={
                  completed
                    ? `凭证 · 系统打款 · ${networkName(completed.chain)} · ${completed.asset}`
                    : "凭证"
                }
                wide
              >
                <ProofValue proof={data.proof ?? ""} payout={completed} />
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
      {data.payouts.length ? (
        <PayoutRecords
          payouts={data.payouts}
          adminName={adminName}
          onResume={() => setDialog("payout")}
          onNotSent={setNotSent}
        />
      ) : null}
      <SettlementItems settlement={data} />
      {dialog === "payout" ? (
        <PayoutDialog
          open
          settlement={data}
          quoted={quoted}
          previous={data.payouts[0]}
          onClose={() => setDialog(null)}
        />
      ) : null}
      <CancelDialog settlement={data} open={dialog === "cancel"} onClose={() => setDialog(null)} />
      {notSent ? (
        <NotSentDialog settlementId={data.id} payout={notSent} onClose={() => setNotSent(null)} />
      ) : null}
    </AdminPage>
  );
}

/** The settled proof: a transaction with its explorer, or the provider's payment id. */
function ProofValue({ proof, payout }: { proof: string; payout?: PayoutData }) {
  const link = payout?.externalTx ? explorerLink(payout.chain, payout.externalTx) : null;
  return (
    <span className="flex flex-col gap-2 rounded-md bg-muted px-3 py-2.5">
      <span className="text-xs text-muted-foreground">
        {payout && !payout.externalTx ? "付款 ID" : "交易哈希"}
      </span>
      <span className="font-mono">{proof}</span>
      <span className="flex flex-wrap gap-2">
        {link ? (
          <Button
            variant="outline"
            size="xs"
            nativeButton={false}
            render={<a href={link.href} target="_blank" rel="noreferrer" />}
          >
            <ExternalLink data-icon="inline-start" aria-hidden="true" />
            {link.name}
          </Button>
        ) : null}
        <CopyButton value={proof} />
      </span>
    </span>
  );
}

type Step = { label: string; at: string | null; detail?: string | null };
function steps(payout: PayoutData, adminName: (id: string | null) => string): Step[] {
  const list: Step[] = [
    {
      label: "生成报价",
      at: `${formatBeijing(payout.createdAt)} · ${adminName(payout.createdBy)}`,
    },
  ];
  if (payout.submittedAt)
    list.push({
      label: "提交打款",
      at: `${formatBeijing(payout.submittedAt)} · ${adminName(payout.submittedBy)}`,
    });
  const resolved = formatBeijing(payout.resolvedAt);
  switch (payout.displayStatus) {
    case "expired":
      list.push({ label: "报价已过期", at: formatBeijing(payout.quoteExpiresAt) });
      break;
    case "pending":
      list.push({ label: "跨链处理", at: null });
      break;
    case "unconfirmed":
      list.push({ label: "提交结果待确认", at: null });
      break;
    case "completed":
      list.push({ label: `${payout.asset} 已到账`, at: resolved });
      break;
    case "refunded":
      list.push({ label: "已退回钱包", at: resolved });
      break;
    case "failed":
      list.push({ label: "失败", at: resolved });
      break;
    case "not_sent":
      list.push({
        label: "标记为未发出",
        at: `${resolved} · ${adminName(payout.resolvedBy)}`,
        detail: payout.notSentReason,
      });
      break;
  }
  return list;
}

function PayoutRecords({
  payouts,
  adminName,
  onResume,
  onNotSent,
}: {
  payouts: readonly PayoutData[];
  adminName: (id: string | null) => string;
  onResume: () => void;
  onNotSent: (payout: PayoutData) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>打款记录</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {payouts.map((payout) => (
          <PayoutRecord
            key={payout.id}
            payout={payout}
            adminName={adminName}
            onResume={onResume}
            onNotSent={() => onNotSent(payout)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function PayoutRecord({
  payout,
  adminName,
  onResume,
  onNotSent,
}: {
  payout: PayoutData;
  adminName: (id: string | null) => string;
  onResume: () => void;
  onNotSent: () => void;
}) {
  const live = payout.status === "quoted";
  const secondsLeft = useSecondsLeft(live ? payout.quoteExpiresAt : null);
  const units = (value: string) => `${formatTokenUnits(value, payout.decimals)} ${payout.asset}`;
  const link = payout.externalTx ? explorerLink(payout.chain, payout.externalTx) : null;
  return (
    <div className="grid gap-6 py-5 first:pt-0 last:pb-0 md:grid-cols-[1fr_280px]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">
            {networkName(payout.chain)} · {payout.asset}
          </span>
          <PayoutStatusBadge
            status={live && secondsLeft === 0 ? "expired" : payout.displayStatus}
          />
          {live && secondsLeft > 0 ? (
            <span className="text-sm text-muted-foreground tabular-nums">
              报价剩余 {formatCountdown(secondsLeft)}
            </span>
          ) : null}
        </div>
        <span className="font-mono text-sm break-all">{payout.address}</span>
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-x-6 gap-y-3">
          <Detail label="预计到账">≈ {units(payout.estimatedOut)}</Detail>
          <Detail label="手续费">{units(payout.feeOut)}</Detail>
          <Detail label="服务商">{payout.provider === "orchestra" ? "Orchestra" : "Boltz"}</Detail>
          {payout.deliveredOut ? (
            <Detail label="实收">
              <span className="font-semibold">{units(payout.deliveredOut)}</span>
            </Detail>
          ) : null}
        </dl>
        {payout.externalTx ? (
          <div className="flex flex-col gap-2 rounded-md bg-muted px-3 py-2.5 text-sm">
            <span className="text-xs text-muted-foreground">{networkName(payout.chain)} 交易</span>
            <span className="font-mono break-all">{payout.externalTx}</span>
            <span className="flex flex-wrap gap-2">
              {link ? (
                <Button
                  variant="outline"
                  size="xs"
                  nativeButton={false}
                  render={<a href={link.href} target="_blank" rel="noreferrer" />}
                >
                  <ExternalLink data-icon="inline-start" aria-hidden="true" />
                  {link.name}
                </Button>
              ) : null}
              <CopyButton value={payout.externalTx} />
            </span>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {payout.displayStatus === "unconfirmed" ? (
            <Button variant="outline" size="sm" onClick={onNotSent}>
              标记为未发出
            </Button>
          ) : null}
          {live && secondsLeft > 0 ? (
            <Button size="sm" onClick={onResume}>
              继续打款
            </Button>
          ) : null}
        </div>
      </div>
      <ol className="flex flex-col gap-3 border-l pl-4 text-sm">
        {steps(payout, adminName).map((step) => (
          <li key={step.label} className="flex flex-col gap-0.5">
            <span className="font-medium">{step.label}</span>
            {step.at ? <span className="text-muted-foreground tabular-nums">{step.at}</span> : null}
            {step.detail ? <span className="text-muted-foreground">{step.detail}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function NotSentDialog({
  settlementId,
  payout,
  onClose,
}: {
  settlementId: string;
  payout: PayoutData;
  onClose: () => void;
}) {
  const { form, dialogProps } = useWriteDialog({
    defaultValues: { reason: "" },
    mutationFn: (value) =>
      adminApi.markPayoutNotSent({
        params: { settlementId, payoutId: payout.id },
        payload: { reason: value.reason.trim() },
      }),
    toast: () => ({ title: "已标记为未发出" }),
    onClose,
  });
  return (
    <FormDialog
      {...dialogProps}
      open
      title="标记为未发出"
      description="确认资金没有转出后再标记，标记后不能撤销，结算单可以重新打款。"
      submitLabel="标记为未发出"
      destructive
    >
      <form.AppField
        name="reason"
        validators={{ onBlur: validateNotSentReason, onSubmit: validateNotSentReason }}
      >
        {(field) => <field.TextareaField label="原因" rows={3} maxLength={500} />}
      </form.AppField>
    </FormDialog>
  );
}

type SettlementItem = Awaited<ReturnType<typeof adminApi.settlementOrders>>["items"][number];
const itemHelper = createAppColumnHelper<SettlementItem>();

function SettlementItems({ settlement }: { settlement: SettlementDetailData }) {
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
  const { table, list: items } = useServerList({
    search: paginationParsers,
    key: ["settlement-orders", settlement.id],
    count: "total",
    fetchPage: (page, _filters, signal) =>
      adminApi.settlementOrders(
        { params: { settlementId: settlement.id }, query: page },
        { signal },
      ),
    columns,
    getRowId: (item) => item.orderId,
    emptyMessage: "没有订单。",
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

function CancelDialog({
  settlement,
  open,
  onClose,
}: {
  settlement: SettlementDetailData;
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
