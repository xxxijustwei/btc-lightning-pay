import { Alert, AlertDescription, AlertTitle } from "@btc-lightning-pay/ui/components/alert";
import { Badge } from "@btc-lightning-pay/ui/components/badge";
import { Button } from "@btc-lightning-pay/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@btc-lightning-pay/ui/components/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@btc-lightning-pay/ui/components/field";
import { Input } from "@btc-lightning-pay/ui/components/input";
import { Skeleton } from "@btc-lightning-pay/ui/components/skeleton";
import { Spinner } from "@btc-lightning-pay/ui/components/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@btc-lightning-pay/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Ban, CircleAlert, ExternalLink, Info, Pencil, Plus } from "lucide-react";
import { useRef, useState } from "react";
import {
  AdminApiError,
  adminApi,
  describeAdminError,
  type MerchantData,
} from "../../lib/api/admin";
import { formatBeijing, formatSats, shortId } from "../../lib/format";
import {
  ConfirmDialog,
  Detail,
  EmptyRow,
  EnabledBadge,
  ErrorState,
  LoadingRows,
  SettlementStatusBadge,
  newIdempotencyKey,
} from "./common";
import { ToggleMerchantDialog } from "./merchants-page";
import { merchantQuery, summaryQuery } from "./queries";
import { AdminPage } from "./shell";

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
      description={
        <>
          <span className="font-mono">/{data.slug}</span> · {data.email}
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
            <Detail label="登录邮箱">{data.email}</Detail>
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
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // One click → one key; a retry after a network error reuses it and returns the same batch.
  const key = useRef<string | null>(null);
  const generate = useMutation({
    mutationFn: () => {
      key.current ??= newIdempotencyKey();
      return adminApi.createSettlement(merchantId, key.current);
    },
    onSuccess: async (settlement) => {
      key.current = null;
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      await navigate({ to: "/settlements/$settlementId", params: { settlementId: settlement.id } });
    },
    onError: (error) => {
      // Keep the key only when the outcome is unknown (no response or server fault).
      if (error instanceof AdminApiError && error.status > 0 && error.status < 500)
        key.current = null;
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
      badge: data && data.pendingSettlementSat > 0,
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
                  {card.badge ? <Badge variant="warning">待付款</Badge> : null}
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
              <AlertTitle>还有 {data.unconfirmedOrderCount} 笔订单尚未确认到账</AlertTitle>
              <AlertDescription>
                包括开票中、待支付和到期后仍未确认的订单，不代表已实际付款。它们不会进入本次结算单；如有疑问，可稍后补查到账后再生成。
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}

function MerchantSettlements({ merchantId }: { merchantId: string }) {
  const settlements = useQuery({
    queryKey: ["admin", "settlements", { merchantId, limit: 5 }],
    queryFn: ({ signal }) => adminApi.settlements({ merchantId, limit: 5, offset: 0 }, signal),
  });
  return (
    <Card className="gap-0 pb-0">
      <CardHeader className="pb-4">
        <CardTitle>该商户的结算单</CardTitle>
        <Link
          to="/settlements"
          search={{ merchantId }}
          className="col-start-2 row-start-1 self-center justify-self-end text-sm font-medium underline-offset-4 hover:underline"
        >
          查看全部
        </Link>
      </CardHeader>
      {settlements.isError ? (
        <div className="p-6">
          <ErrorState error={settlements.error} onRetry={() => void settlements.refetch()} />
        </div>
      ) : (
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead className="pl-6">编号</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">应付 (sats)</TableHead>
              <TableHead>笔数</TableHead>
              <TableHead>截止时间（北京）</TableHead>
              <TableHead className="pr-6 text-right">
                <span className="sr-only">操作</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {settlements.isPending ? (
              <LoadingRows columns={6} rows={3} />
            ) : settlements.data.items.length === 0 ? (
              <EmptyRow columns={6}>还没有结算单。</EmptyRow>
            ) : (
              settlements.data.items.map((settlement) => (
                <TableRow key={settlement.id}>
                  <TableCell className="pl-6 font-mono">{shortId(settlement.id)}</TableCell>
                  <TableCell>
                    <SettlementStatusBadge status={settlement.status} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatSats(settlement.amountSat)}
                  </TableCell>
                  <TableCell>{settlement.orderCount} 笔</TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatBeijing(settlement.cutoffAt)}
                  </TableCell>
                  <TableCell className="pr-6 text-right">
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
              ))
            )}
          </TableBody>
        </Table>
      )}
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
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(merchant.name);
  const rename = useMutation({
    mutationFn: (name: string) => adminApi.updateMerchant(merchant.id, { name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      rename.reset();
      onOpenChange(false);
    },
  });
  const name = draft.trim();
  const invalid = !name || name.length > 100;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(merchant.name);
        rename.reset();
        onOpenChange(next);
      }}
      title="修改名称"
      description="名称仅管理员可见，不会出现在付款页。slug 和邮箱不能修改。"
      confirmLabel="保存"
      pending={rename.isPending}
      confirmDisabled={invalid || name === merchant.name}
      error={rename.isError ? describeAdminError(rename.error) : undefined}
      onConfirm={() => rename.mutate(name)}
    >
      <Field data-invalid={invalid ? true : undefined}>
        <FieldLabel htmlFor="rename-merchant">名称</FieldLabel>
        <Input
          id="rename-merchant"
          value={draft}
          maxLength={100}
          aria-invalid={invalid ? true : undefined}
          onChange={(event) => setDraft(event.target.value)}
        />
        {invalid ? (
          <FieldError>名称需 1–100 个字符，不能全是空格。</FieldError>
        ) : (
          <FieldDescription>1–100 个字符。</FieldDescription>
        )}
      </Field>
    </ConfirmDialog>
  );
}
