import { Alert, AlertDescription, AlertTitle } from "@btc-lightning-pay/ui/components/alert";
import { Badge } from "@btc-lightning-pay/ui/components/badge";
import { Button } from "@btc-lightning-pay/ui/components/button";
import { Spinner } from "@btc-lightning-pay/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { Check, CircleAlert, Copy } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  describeAdminError,
  type PaymentStatusValue,
  type PayoutDisplayStatusValue,
  type SettlementData,
  type SettlementDisplayStatusValue,
  type SettlementStatusValue,
} from "../../lib/api/admin";
import { formatBeijing, formatSats, formatUsd } from "../../lib/format";
import { formatTokenUnits, satsToUsd } from "../../lib/payout";
import { btcQuoteQuery } from "./queries";

const orderStatus: Record<
  PaymentStatusValue,
  { label: string; variant: "warning" | "success" | "outline" }
> = {
  pending: { label: "待支付", variant: "warning" },
  paid: { label: "已支付", variant: "success" },
  expired: { label: "已过期", variant: "outline" },
};

export const orderStatusOptions = Object.entries(orderStatus).map(([value, { label }]) => ({
  value: value as PaymentStatusValue,
  label,
}));

export function OrderStatusBadge({ status }: { status: PaymentStatusValue }) {
  const { label, variant } = orderStatus[status];
  return <Badge variant={variant}>{label}</Badge>;
}

const settlementStatus: Record<
  SettlementStatusValue,
  { label: string; variant: "warning" | "success" | "outline" }
> = {
  pending: { label: "待付款", variant: "warning" },
  settled: { label: "已结算", variant: "success" },
  cancelled: { label: "已取消", variant: "outline" },
};

export const settlementStatusOptions = Object.entries(settlementStatus).map(
  ([value, { label }]) => ({
    value: value as SettlementStatusValue,
    label,
  }),
);

export function SettlementStatusBadge({
  status,
}: {
  status: SettlementStatusValue | SettlementDisplayStatusValue;
}) {
  if (status === "paying")
    return (
      <Badge variant="info">
        <Spinner aria-hidden="true" />
        打款中
      </Badge>
    );
  if (status === "unconfirmed") return <Badge variant="warning">结果待确认</Badge>;
  const { label, variant } = settlementStatus[status];
  return <Badge variant={variant}>{label}</Badge>;
}

const payoutStatus: Record<
  PayoutDisplayStatusValue,
  {
    label: string;
    variant: "outline" | "info" | "warning" | "success" | "secondary" | "destructive";
    className?: string;
    busy?: boolean;
  }
> = {
  quoted: { label: "已报价", variant: "outline" },
  expired: { label: "已过期", variant: "outline", className: "text-muted-foreground" },
  submitting: { label: "提交中", variant: "info", busy: true },
  unconfirmed: { label: "结果待确认", variant: "warning" },
  pending: { label: "处理中", variant: "info", busy: true },
  completed: { label: "已完成", variant: "success" },
  refunded: {
    label: "已退款",
    variant: "secondary",
    className: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  },
  failed: { label: "失败", variant: "destructive" },
  not_sent: { label: "未发出", variant: "secondary" },
};

export function PayoutStatusBadge({ status }: { status: PayoutDisplayStatusValue }) {
  const { label, variant, className, busy } = payoutStatus[status];
  return (
    <Badge variant={variant} className={className}>
      {busy ? <Spinner aria-hidden="true" /> : null}
      {label}
    </Badge>
  );
}

/**
 * "≈ $X": what `sats` still held in BTC are worth at the latest stored price. Only for amounts
 * that move with the market; settled facts show their original price or what was received.
 */
export function CurrentValue({ sats, className }: { sats: number; className?: string }) {
  const quote = useQuery(btcQuoteQuery());
  if (!quote.data) return <span className={className}>≈ —</span>;
  const rate = Number(quote.data.rateUsd).toLocaleString("en-US");
  return (
    <span
      className={className}
      title={`1 BTC ≈ $${rate} · Coinbase · ${formatBeijing(quote.data.quotedAt, false)}`}
    >
      ≈ {satsToUsd(sats, quote.data.rateUsd)}
    </span>
  );
}

const amountSizes = { sm: "text-sm", lg: "text-xl", xl: "text-2xl" } as const;

/**
 * An amount in the console's house style: dollars as the main figure, with the ledger's sats
 * (and any reference figure) on a smaller line underneath.
 */
export function Amount({
  main,
  sub,
  size = "sm",
  align = "start",
  muted,
}: {
  main: ReactNode;
  sub?: ReactNode;
  size?: keyof typeof amountSizes;
  align?: "start" | "end";
  muted?: boolean;
}) {
  return (
    <span className={`inline-flex flex-col ${align === "end" ? "items-end" : "items-start"}`}>
      <span
        className={`${amountSizes[size]} font-semibold tabular-nums ${muted ? "text-muted-foreground" : ""}`}
      >
        {main}
      </span>
      {sub ? (
        <span className="text-xs font-normal text-muted-foreground tabular-nums">{sub}</span>
      ) : null}
    </span>
  );
}

export const satsLabel = (sats: number) => `${formatSats(sats)} sats`;

/** A settlement's figure: current value while unpaid, received stablecoin once settled. */
export function SettlementAmount({
  settlement,
  size,
  align,
}: {
  settlement: Pick<SettlementData, "status" | "amountSat" | "amountUsdCents" | "delivered">;
  size?: keyof typeof amountSizes;
  align?: "start" | "end";
}) {
  const sats = satsLabel(settlement.amountSat);
  const original = `原价 ${formatUsd(settlement.amountUsdCents)}`;
  if (settlement.status === "pending")
    return (
      <Amount
        size={size}
        align={align}
        main={<CurrentValue sats={settlement.amountSat} />}
        sub={`${sats} · ${original}`}
      />
    );
  if (settlement.status === "settled" && settlement.delivered)
    return (
      <Amount
        size={size}
        align={align}
        main={`${formatTokenUnits(settlement.delivered.deliveredOut, settlement.delivered.decimals)} ${settlement.delivered.asset}`}
        sub={`${sats} · ${original}`}
      />
    );
  return (
    <Amount
      size={size}
      align={align}
      muted={settlement.status === "cancelled"}
      main={formatUsd(settlement.amountUsdCents)}
      sub={sats}
    />
  );
}

/** Settlement state of an order: occupied by a pending batch, settled, or not yet in any batch. */
export function OrderSettlementBadge({
  status,
  paid,
}: {
  status: "pending" | "settled" | null;
  paid: boolean;
}) {
  if (status === "pending") return <Badge variant="warning">结算中</Badge>;
  if (status === "settled") return <Badge variant="success">已结算</Badge>;
  return <span className="text-muted-foreground">{paid ? "未结算" : "—"}</span>;
}

export function EnabledBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <Badge variant="success">启用</Badge>
  ) : (
    <Badge variant="secondary">已停用</Badge>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>加载失败</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        {describeAdminError(error)}
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            重试
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

export function CopyButton({ value, label = "复制" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      variant="outline"
      size="xs"
      onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))}
    >
      {copied ? (
        <Check data-icon="inline-start" aria-hidden="true" />
      ) : (
        <Copy data-icon="inline-start" aria-hidden="true" />
      )}
      <span aria-live="polite">{copied ? "已复制" : label}</span>
    </Button>
  );
}

export function Detail({
  label,
  children,
  wide,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${wide ? "col-span-full" : ""}`}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm break-all">{children}</dd>
    </div>
  );
}
