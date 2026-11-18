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
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "@btc-lightning-pay/ui/components/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@btc-lightning-pay/ui/components/select";
import { Skeleton } from "@btc-lightning-pay/ui/components/skeleton";
import { Spinner } from "@btc-lightning-pay/ui/components/spinner";
import { TableCell, TableRow } from "@btc-lightning-pay/ui/components/table";
import { Check, ChevronLeft, ChevronRight, CircleAlert, Copy } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  describeAdminError,
  type PaymentStatusValue,
  type SettlementStatusValue,
} from "../../lib/api/admin";

const orderStatus: Record<
  PaymentStatusValue,
  { label: string; variant: "info" | "warning" | "success" | "outline" | "destructive" }
> = {
  creating: { label: "开票中", variant: "info" },
  pending: { label: "待支付", variant: "warning" },
  paid: { label: "已支付", variant: "success" },
  expired: { label: "已过期", variant: "outline" },
  failed: { label: "失败", variant: "destructive" },
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

export const PAGE_SIZES = [10, 20, 30, 40, 50] as const;

function pageNumbers(page: number, count: number): (number | "…")[] {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, "…", count];
  if (page >= count - 3) return [1, "…", count - 4, count - 3, count - 2, count - 1, count];
  return [1, "…", page - 1, page, page + 1, "…", count];
}

/**
 * Footer for list pages. With `total` it shows every page; without it (APIs that return
 * bare arrays) it shows the current page and relies on `hasNext`.
 */
export function ListPagination({
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  total,
  hasNext,
}: {
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  total?: number;
  hasNext?: boolean;
}) {
  const count = total === undefined ? undefined : Math.max(1, Math.ceil(total / pageSize));
  const atLast = count === undefined ? !hasNext : page >= count;
  const numbers = count === undefined ? [page] : pageNumbers(page, count);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground">
        {total === undefined ? `第 ${page} 页` : `共 ${total} 条 · 第 ${page} / ${count} 页`}
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span id="page-size-label" className="font-medium whitespace-nowrap">
            每页行数
          </span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => value && onPageSizeChange(Number(value))}
            items={PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
          >
            <SelectTrigger size="sm" className="w-[72px]" aria-labelledby="page-size-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Pagination className="mx-0 w-auto">
          <PaginationContent>
            <PaginationItem>
              <Button
                variant="ghost"
                className="pl-2"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
              >
                <ChevronLeft data-icon="inline-start" aria-hidden="true" />
                上一页
              </Button>
            </PaginationItem>
            {numbers.map((value, index) =>
              value === "…" ? (
                <PaginationItem key={`gap-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={value}>
                  <Button
                    variant={value === page ? "outline" : "ghost"}
                    size="icon"
                    aria-current={value === page ? "page" : undefined}
                    aria-label={`第 ${value} 页`}
                    onClick={() => onPageChange(value)}
                  >
                    {value}
                  </Button>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              <Button
                variant="ghost"
                className="pr-2"
                disabled={atLast}
                onClick={() => onPageChange(page + 1)}
              >
                下一页
                <ChevronRight data-icon="inline-end" aria-hidden="true" />
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
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

export function LoadingRows({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return Array.from({ length: rows }, (_, row) => (
    <TableRow key={row}>
      {Array.from({ length: columns }, (_, column) => (
        <TableCell key={column}>
          <Skeleton className="h-4 w-full max-w-32" />
        </TableCell>
      ))}
    </TableRow>
  ));
}

export function EmptyRow({ columns, children }: { columns: number; children: ReactNode }) {
  return (
    <TableRow>
      <TableCell colSpan={columns} className="h-24 text-center text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
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
  children,
  confirmDisabled,
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
  children?: ReactNode;
  confirmDisabled?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
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
            disabled={pending || confirmDisabled}
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
