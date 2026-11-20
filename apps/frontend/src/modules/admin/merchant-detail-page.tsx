import { Alert, AlertDescription, AlertTitle } from "@btc-lightning-pay/ui/components/alert";
import { Badge } from "@btc-lightning-pay/ui/components/badge";
import { Button } from "@btc-lightning-pay/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@btc-lightning-pay/ui/components/card";
import { Skeleton } from "@btc-lightning-pay/ui/components/skeleton";
import { Spinner } from "@btc-lightning-pay/ui/components/spinner";
import { toast } from "@btc-lightning-pay/ui/components/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Ban, CircleAlert, ExternalLink, Info, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import {
  adminApi,
  describeAdminError,
  type MerchantData,
  type SettlementData,
} from "../../lib/api/admin";
import { DataTable } from "../../components/data-table/data-table";
import { useAppTable } from "../../components/data-table/table-hook";
import { formatBeijing, formatSats } from "../../lib/format";
import { validateName } from "../../lib/validation";
import { Detail, EnabledBadge, ErrorState } from "./common";
import { FormDialog } from "./form-dialog";
import { useGenerateSettlement } from "./generate-settlement";
import { ToggleMerchantDialog } from "./merchants-page";
import {
  merchantQuery,
  pendingSettlementsQuery,
  recentSettlementsQuery,
  summaryQuery,
} from "./queries";
import { settlementColumns } from "./settlements-page";
import { AdminPage } from "./shell";
import { useWriteDialog } from "./write-dialog";

const payOrigin = import.meta.env.VITE_PAY_ORIGIN as string | undefined;

export function MerchantDetailPage({ merchantId }: { merchantId: string }) {
  const merchant = useQuery(merchantQuery(merchantId));
  const [renaming, setRenaming] = useState(false);
  const [toggling, setToggling] = useState(false);

  if (merchant.isPending) {
    return (
      <AdminPage crumbs={[{ label: "商户", to: "/merchants" }, { label: "…" }]}>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
      </AdminPage>
    );
  }
  if (merchant.isError) {
    return (
      <AdminPage crumbs={[{ label: "商户", to: "/merchants" }, { label: "详情" }]}>
        <ErrorState error={merchant.error} onRetry={() => void merchant.refetch()} />
      </AdminPage>
    );
  }
  const data = merchant.data;
  const link = payOrigin ? `${payOrigin.replace(/\/$/, "")}/${data.slug}` : `/${data.slug}`;

  return (
    <AdminPage
      crumbs={[{ label: "商户", to: "/merchants" }, { label: data.name }]}
      title={
        <>
          <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
          <EnabledBadge enabled={data.enabled} />
        </>
      }
      actions={
        <>
          {payOrigin ? (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<a href={link} target="_blank" rel="noreferrer" />}
            >
              <ExternalLink data-icon="inline-start" aria-hidden="true" />
              打开收款页
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link to="/orders" search={{ merchantId: data.id }} />}
          >
            查看订单
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRenaming(true)}>
            <Pencil data-icon="inline-start" aria-hidden="true" />
            修改名称
          </Button>
          <Button
            variant={data.enabled ? "destructive" : "default"}
            size="sm"
            onClick={() => setToggling(true)}
          >
            <Ban data-icon="inline-start" aria-hidden="true" />
            {data.enabled ? "停用商户" : "恢复商户"}
          </Button>
        </>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-6 gap-y-4">
            <Detail label="收款链接">
              <span className="font-mono">{link}</span>
            </Detail>
            <Detail label="商户邮箱">{data.email}</Detail>
            <Detail label="账号">
              <Link to="/accounts" className="underline-offset-4 hover:underline">
                商户账号 · {data.enabled ? "正常" : "已禁用"}
              </Link>
              <span className="text-muted-foreground"> · 第一阶段不可登录</span>
            </Detail>
            <Detail label="创建时间">{formatBeijing(data.createdAt, false)}</Detail>
            <Detail label="内部 ID" wide>
              <span className="font-mono text-muted-foreground">{data.id}</span>
            </Detail>
          </dl>
        </CardContent>
      </Card>
      <SummarySection merchantId={data.id} />
      <MerchantSettlements merchantId={data.id} />
      <RenameDialog merchant={data} open={renaming} onOpenChange={setRenaming} />
      <ToggleMerchantDialog merchant={toggling ? data : null} onClose={() => setToggling(false)} />
    </AdminPage>
  );
}

function SummarySection({ merchantId }: { merchantId: string }) {
  const summary = useQuery(summaryQuery(merchantId));
  const pendingSettlements = useQuery(pendingSettlementsQuery(merchantId));
  const pendingCount = pendingSettlements.data?.total ?? 0;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const generate = useGenerateSettlement(merchantId, {
    onSuccess: async (settlement) => {
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      toast.add({
        title: "结算单已生成",
        description: `${settlement.orderCount} 笔订单 · ${formatSats(settlement.amountSat)} sats`,
        type: "success",
      });
      await navigate({ to: "/settlements/$settlementId", params: { settlementId: settlement.id } });
    },
  });

  if (summary.isError)
    return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />;
  const data = summary.data;
  const cards = [
    { label: "已支付应付", value: data?.paidSat },
    { label: "已结算", value: data?.settledSat },
    {
      label: "待付款占用",
      value: data?.pendingSettlementSat,
      badge: data && data.pendingSettlementSat > 0 && pendingCount > 0,
    },
    { label: "可生成结算单", value: data?.availableSettlementSat },
  ];
  const available = data?.availableSettlementSat ?? 0;

  return (
    <>
      <section aria-label="应付汇总" className="flex flex-col gap-2">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
          {cards.map((card) => (
            <Card key={card.label} size="sm">
              <CardHeader>
                <CardDescription className="flex items-center justify-between gap-2">
                  {card.label}
                  {card.badge ? <Badge variant="warning">{pendingCount} 张待付款</Badge> : null}
                </CardDescription>
                <CardTitle className="text-2xl font-semibold tabular-nums">
                  {card.value === undefined ? (
                    <Skeleton className="h-8 w-28" />
                  ) : (
                    <>
                      {formatSats(card.value)}{" "}
                      <span className="text-sm font-normal text-muted-foreground">sats</span>
                    </>
                  )}
                </CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
        {data ? (
          <p className="text-xs text-muted-foreground">
            未结清 = 已支付应付 − 已结算 = {formatSats(data.unsettledSat)}{" "}
            sats（含待付款占用）。按已支付订单的 sats 记账，不是钱包余额。
          </p>
        ) : null}
      </section>
      <Card>
        <CardHeader>
          <CardTitle>生成结算单</CardTitle>
          <CardDescription>
            锁定截至生成时刻、该商户所有已到账且未被其他结算单占用的订单，包括往日积累。之后新到账的订单顺延到下一张。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-end gap-4">
            <div className="flex flex-col items-end">
              <span className="text-xs text-muted-foreground">预览金额（以生成结果为准）</span>
              <span className="text-xl font-semibold tabular-nums">
                {formatSats(available)}{" "}
                <span className="text-sm font-normal text-muted-foreground">sats</span>
              </span>
            </div>
            <Button
              disabled={!data || available <= 0 || generate.isPending}
              aria-busy={generate.isPending}
              onClick={() => generate.mutate()}
            >
              {generate.isPending ? (
                <Spinner aria-hidden="true" data-icon="inline-start" />
              ) : (
                <Plus data-icon="inline-start" aria-hidden="true" />
              )}
              生成结算单
            </Button>
          </div>
          {generate.isError ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{describeAdminError(generate.error)}</AlertDescription>
            </Alert>
          ) : null}
          {data && data.unconfirmedOrderCount > 0 ? (
            <Alert>
              <Info aria-hidden="true" />
              <AlertTitle>还有 {data.unconfirmedOrderCount} 笔订单待支付</AlertTitle>
              <AlertDescription>
                发票尚未过期，付款后会自动确认到账。它们不会进入本次结算单。
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}

const noSettlements: SettlementData[] = [];

function MerchantSettlements({ merchantId }: { merchantId: string }) {
  const settlements = useQuery(recentSettlementsQuery(merchantId));
  // Same columns as the settlements list; the merchant and creation time are implied here.
  const table = useAppTable({
    columns: settlementColumns,
    data: settlements.data?.items ?? noSettlements,
    getRowId: (settlement) => settlement.id,
    initialState: { columnVisibility: { merchantId: false, createdAt: false } },
    meta: { emptyMessage: "还没有结算单。" },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>该商户的结算单</CardTitle>
        <CardDescription>最近 5 张。</CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link to="/settlements" search={{ merchantId }} />}
          >
            查看全部
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {settlements.isError ? (
          <ErrorState error={settlements.error} onRetry={() => void settlements.refetch()} />
        ) : (
          <table.AppTable>
            <DataTable loading={settlements.isPending} />
          </table.AppTable>
        )}
      </CardContent>
    </Card>
  );
}

function RenameDialog({
  merchant,
  open,
  onOpenChange,
}: {
  merchant: MerchantData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { form, dialogProps } = useWriteDialog({
    defaultValues: { name: merchant.name },
    // An unchanged name needs no request.
    mutationFn: async (value) => {
      const name = value.name.trim();
      return name === merchant.name
        ? null
        : adminApi.updateMerchant({ params: { merchantId: merchant.id }, payload: { name } });
    },
    toast: (updated) => ({ title: "名称已更新", description: updated?.name }),
    onSuccess: (updated, _value, { close }) => {
      if (updated) return;
      close();
      return "handled";
    },
    onClose: () => onOpenChange(false),
  });
  return (
    <FormDialog
      {...dialogProps}
      open={open}
      title="修改名称"
      description="名称仅管理员可见，不会出现在付款页。slug 和邮箱不能修改。"
      submitLabel="保存"
    >
      <form.AppField name="name" validators={{ onChange: validateName, onSubmit: validateName }}>
        {(field) => <field.TextField label="名称" maxLength={100} description="1–100 个字符。" />}
      </form.AppField>
    </FormDialog>
  );
}
