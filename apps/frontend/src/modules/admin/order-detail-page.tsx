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
import { adminApi, type AdminOrderData, type SettlementData } from "../../lib/api/admin";
import { invoiceCreatedAt } from "../../lib/bolt11";
import { formatBeijing, formatMsatAsSats, formatSats, formatUsd, shortId } from "../../lib/format";
import {
  CopyButton,
  Detail,
  ErrorState,
  OrderSettlementBadge,
  OrderStatusBadge,
  SettlementStatusBadge,
} from "./common";
import { useMerchantNames } from "./merchant-select";
import { AdminPage } from "./shell";

const payOrigin = import.meta.env.VITE_PAY_ORIGIN as string | undefined;

export function OrderDetailPage({ orderId }: { orderId: string }) {
  const order = useQuery({
    queryKey: ["admin", "order", orderId],
    queryFn: ({ signal }) => adminApi.order(orderId, signal),
  });
  const settlementId = order.data?.settlementId ?? null;
  const settlement = useQuery({
    queryKey: ["admin", "settlement", settlementId],
    queryFn: ({ signal }) => adminApi.settlement(settlementId!, signal),
    enabled: settlementId !== null,
  });
  const names = useMerchantNames();
  const crumbs = [{ label: "订单", to: "/orders" }, { label: shortId(orderId) }];

  if (order.isPending) {
    return (
      <AdminPage crumbs={crumbs}>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-48 w-full" />
      </AdminPage>
    );
  }
  if (order.isError) {
    return (
      <AdminPage crumbs={crumbs}>
        <ErrorState error={order.error} onRetry={() => void order.refetch()} />
      </AdminPage>
    );
  }
  const data = order.data;
  const merchant = names.get(data.merchantId);
  const payLink = `${payOrigin ? payOrigin.replace(/\/$/, "") : ""}/pay/invoice/${data.id}`;

  return (
    <AdminPage
      crumbs={crumbs}
      title={
        <>
          <h1 className="text-2xl font-semibold tracking-tight">订单详情</h1>
          <OrderStatusBadge status={data.status} />
          <OrderSettlementBadge status={data.settlementStatus} paid={data.status === "paid"} />
        </>
      }
      description={<span className="font-mono break-all">{data.id}</span>}
      actions={
        <>
          <CopyButton value={payLink} label="复制付款链接" />
          {data.settlementId ? (
            <Button
              size="sm"
              nativeButton={false}
              render={
                <Link
                  to="/settlements/$settlementId"
                  params={{ settlementId: data.settlementId }}
                />
              }
            >
              查看结算单
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>金额与报价快照</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-6 gap-y-4">
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
                <Detail label="原始 USD 金额">{formatUsd(data.amountUsdCents)}</Detail>
                <Detail label="固定 sats（向上取整）">
                  <span className="font-mono">{formatSats(data.amountSat)}</span>
                </Detail>
                <Detail label="BTC/USD 参考价">
                  <span className="font-mono">{data.rateUsd}</span>
                </Detail>
                <Detail label="行情来源">Coinbase</Detail>
                <Detail label="行情获取时间">{formatBeijing(data.quotedAt)}</Detail>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Invoice</CardTitle>
              <CardDescription>以 payment hash 标识。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <dl className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-6 gap-y-4">
                <Detail label="开票时间">{formatBeijing(invoiceCreatedAt(data.invoice))}</Detail>
                <Detail label="到期时间">{formatBeijing(data.expiresAt)}</Detail>
                <Detail label="Invoice 金额">
                  <span className="font-mono">{formatSats(data.amountSat)} sats</span>
                </Detail>
              </dl>
              <LongValue label="Payment hash" value={data.paymentHash} />
              <LongValue label="BOLT11" value={data.invoice} scroll />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>到账事实</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-6 gap-y-4">
                <Detail label="商户应收">
                  <span className="font-mono">{formatSats(data.amountSat)} sats</span>
                </Detail>
                <Detail label="钱包实收">
                  {data.receivedMsat === null ? (
                    "—"
                  ) : (
                    <>
                      <span className="font-mono">{formatMsatAsSats(data.receivedMsat)} sats</span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {data.receivedMsat.toLocaleString("en-US")} msat ·{" "}
                        {data.receivedMsat === data.amountSat * 1000 ? (
                          "与 invoice 金额核对一致"
                        ) : (
                          <span className="text-destructive">与 invoice 金额不一致</span>
                        )}
                      </span>
                    </>
                  )}
                </Detail>
                <Detail label="到账时间">{formatBeijing(data.paidAt)}</Detail>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>付款人备注与链接</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-4">
                <Detail label="订单号／备注">{data.reference || "—"}</Detail>
                <Detail label="公开付款链接">
                  <span className="font-mono">{payLink}</span>
                </Detail>
              </dl>
            </CardContent>
          </Card>
        </div>
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>时间线</CardTitle>
            </CardHeader>
            <CardContent>
              <Timeline events={timeline(data, settlement.data)} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>结算</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {data.settlementId ? (
                <>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">结算单</span>
                    <Link
                      to="/settlements/$settlementId"
                      params={{ settlementId: data.settlementId }}
                      className="font-mono underline-offset-4 hover:underline"
                    >
                      {shortId(data.settlementId)}
                    </Link>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">结算状态</span>
                    {data.settlementStatus ? (
                      <SettlementStatusBadge status={data.settlementStatus} />
                    ) : (
                      "—"
                    )}
                  </div>
                  {data.settlementStatus === "pending" ? (
                    <p className="text-muted-foreground">
                      已被结算单占用，确认付款后才算已结算；若该单取消，本单会释放并进入下一张。
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-muted-foreground">
                  {data.status === "paid"
                    ? "尚未进入结算单。整笔订单只能归属一次结算，不拆分金额。"
                    : "订单未支付，不参与结算。"}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminPage>
  );
}

function LongValue({
  label,
  value,
  scroll,
}: {
  label: string;
  value: string | null;
  scroll?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {value ? <CopyButton value={value} /> : null}
      </div>
      <p
        className={`rounded-md bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed break-all text-muted-foreground ${
          scroll ? "max-h-24 overflow-y-auto" : ""
        }`}
      >
        {value ?? "—"}
      </p>
    </div>
  );
}

type TimelineEvent = { label: string; at: string | null; tone: string; detail?: string };

/** Order history from the timestamps the order and its settlement record. */
function timeline(order: AdminOrderData, settlement: SettlementData | undefined): TimelineEvent[] {
  // The invoice is issued first; the order is stored only once it exists.
  const events: TimelineEvent[] = [
    { label: "Invoice 已创建，订单生成", at: order.createdAt, tone: "bg-primary" },
  ];
  if (order.paidAt) events.push({ label: "后端核实到账", at: order.paidAt, tone: "bg-success" });
  else if (order.status === "expired")
    events.push({ label: "Invoice 已过期", at: order.expiresAt, tone: "bg-muted-foreground" });
  if (order.settlementId) {
    const pending = order.settlementStatus === "pending";
    events.push({
      label: pending ? "进入结算单（待付款）" : "进入结算单",
      at: settlement?.createdAt ?? null,
      tone: pending ? "bg-warning" : "bg-primary",
      detail: shortId(order.settlementId),
    });
    if (settlement?.status === "settled")
      events.push({ label: "结算单已确认付款", at: settlement.confirmedAt, tone: "bg-success" });
  }
  return events;
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="flex flex-col text-sm">
      {events.map((event, index) => (
        <li key={event.label} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span aria-hidden="true" className={`mt-1.5 size-2.5 rounded-full ${event.tone}`} />
            {index < events.length - 1 ? (
              <span aria-hidden="true" className="min-h-7 w-px flex-1 bg-border" />
            ) : null}
          </div>
          <div className={index < events.length - 1 ? "pb-4" : undefined}>
            <p className="font-medium">{event.label}</p>
            <p className="text-muted-foreground tabular-nums">
              {formatBeijing(event.at)}
              {event.detail ? <span className="font-mono"> · {event.detail}</span> : null}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
