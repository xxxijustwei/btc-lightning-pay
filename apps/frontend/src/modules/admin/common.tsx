import { Alert, AlertDescription, AlertTitle } from "@btc-lightning-pay/ui/components/alert";
import { Badge } from "@btc-lightning-pay/ui/components/badge";
import { Button } from "@btc-lightning-pay/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@btc-lightning-pay/ui/components/dialog";
import { Spinner } from "@btc-lightning-pay/ui/components/spinner";
import { Check, CircleAlert, Copy } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  describeAdminError,
  type PaymentStatusValue,
  type SettlementStatusValue,
} from "../../lib/api/admin";

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

export function SettlementStatusBadge({ status }: { status: SettlementStatusValue }) {
  const { label, variant } = settlementStatus[status];
  return <Badge variant={variant}>{label}</Badge>;
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

/** Confirmation dialog for writes; keeps the dialog open and shows the error when the write fails. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  error?: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            aria-busy={pending}
            onClick={onConfirm}
          >
            {pending ? <Spinner aria-hidden="true" data-icon="inline-start" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

export function newIdempotencyKey() {
  return crypto.randomUUID();
}
