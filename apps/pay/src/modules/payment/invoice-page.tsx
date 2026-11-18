import { useQuery, type Query } from "@tanstack/react-query";
import { Check, Copy, Info, Lock, RotateCcw, Timer, WifiOff, Zap } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState, type ReactNode } from "react";
import { Skeleton } from "@btc-lightning-pay/ui/components/skeleton";
import { Spinner } from "@btc-lightning-pay/ui/components/spinner";
import { formatCountdown, formatUsd } from "../../lib/amount";
import { PublicApiError, getOrder, type PublicOrderData } from "../../lib/public-api";
import { PayShell, primaryActionClass } from "./pay-shell";
import { UnavailableScreen } from "./unavailable-screen";

const ACTIVE_POLL_MS = 3_000;
const HIDDEN_POLL_MS = 15_000;
const EXPIRED_POLL_MS = 15_000;
const MAX_BACKOFF_MS = 30_000;

/** Poll fast while the payer is looking, slow down in the background, back off on failures. */
export function orderPollInterval(query: Query<PublicOrderData, Error>): number | false {
  const { data, error, fetchFailureCount } = query.state;
  if (error instanceof PublicApiError && error.status === 404) return false;
  if (fetchFailureCount > 0)
    return Math.min(ACTIVE_POLL_MS * 2 ** fetchFailureCount, MAX_BACKOFF_MS);
  if (data?.status === "paid" || data?.status === "failed") return false;
  if (data?.status === "expired") return EXPIRED_POLL_MS;
  if (typeof document !== "undefined" && document.visibilityState === "hidden")
    return HIDDEN_POLL_MS;
  return ACTIVE_POLL_MS;
}

export function InvoicePage({
  orderId,
  merchantSlug,
}: {
  orderId: string;
  /** Slug of the merchant link the payer came from, when known. */
  merchantSlug?: string;
}) {
  const newInvoiceHref = merchantSlug ? `/${merchantSlug}` : undefined;
  const order = useQuery({
    queryKey: ["public-order", orderId],
    queryFn: ({ signal }) => getOrder(orderId, signal),
    refetchInterval: orderPollInterval,
    refetchIntervalInBackground: true,
    retry: false,
  });

  if (order.isPending) return <CreatingView />;
  if (!order.data) {
    if (order.error instanceof PublicApiError && order.error.status === 404) {
      return <UnavailableScreen variant="notfound" />;
    }
    return <UnavailableScreen variant="offline" onRetry={() => void order.refetch()} />;
  }

  const data = order.data;
  // A failed refresh keeps the last known order; the banner says we're retrying, not that payment failed.
  const reconnecting = order.isError;
  const clockOffset = Date.parse(data.serverTime) - order.dataUpdatedAt;

  switch (data.status) {
    case "creating":
      return <CreatingView amountUsdCents={data.amountUsdCents} reconnecting={reconnecting} />;
    case "pending":
      return data.invoice && data.expiresAt ? (
        <PendingView
          amountUsdCents={data.amountUsdCents}
          invoice={data.invoice}
          expiresAt={data.expiresAt}
          clockOffset={clockOffset}
          reconnecting={reconnecting}
        />
      ) : (
        <CreatingView amountUsdCents={data.amountUsdCents} reconnecting={reconnecting} />
      );
    case "paid":
      return (
        <PaidView
          amountUsdCents={data.amountUsdCents}
          orderId={data.id}
          merchantSlug={merchantSlug}
        />
      );
    case "expired":
      return (
        <ExpiredView
          amountUsdCents={data.amountUsdCents}
          newInvoiceHref={newInvoiceHref}
          reconnecting={reconnecting}
        />
      );
    case "failed":
      return <FailedView newInvoiceHref={newInvoiceHref} />;
  }
}

function ReconnectingBanner() {
  return (
    <div role="status" className="flex items-start gap-2.5 rounded-[14px] bg-[#f3f4f6] px-3.5 py-3">
      <WifiOff
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-[#374151]"
        strokeWidth={2.2}
      />
      <p className="text-[13px] leading-snug font-bold text-[#374151]">
        Reconnecting… Your invoice is still valid — this doesn't mean the payment failed.
      </p>
    </div>
  );
}

function AmountCard({
  amountUsdCents,
  muted,
  children,
}: {
  amountUsdCents?: number;
  muted?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[18px] border border-pay-line px-5 py-[18px]">
      {amountUsdCents === undefined ? (
        <Skeleton className="h-10 w-32" />
      ) : (
        <p
          className={`text-4xl leading-tight font-black tracking-tight ${muted ? "text-pay-muted" : ""}`}
        >
          <span className="sr-only">Amount </span>
          {formatUsd(amountUsdCents)}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2">{children}</div>
    </div>
  );
}

function CreatingView({
  amountUsdCents,
  reconnecting,
}: {
  amountUsdCents?: number;
  reconnecting?: boolean;
}) {
  return (
    <PayShell
      footer={
        <button type="button" disabled className={primaryActionClass}>
          <Spinner aria-hidden="true" className="size-4" />
          Preparing invoice
        </button>
      }
    >
      {reconnecting ? <ReconnectingBanner /> : null}
      <AmountCard amountUsdCents={amountUsdCents}>
        <span
          role="status"
          className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-[#f3f4f6] px-3 text-[13px] font-extrabold text-[#374151]"
        >
          <Spinner aria-hidden="true" className="size-3.5" />
          Creating invoice
        </span>
      </AmountCard>
      <div className="flex flex-col items-center gap-3.5 rounded-[18px] border border-pay-line px-4 py-5">
        <Skeleton className="size-56" />
        <Skeleton className="h-12 w-full" />
        <p className="text-center text-[13px] font-bold text-[#4b5563]">
          Please wait. This may take a few seconds.
        </p>
      </div>
    </PayShell>
  );
}

function PendingView({
  amountUsdCents,
  invoice,
  expiresAt,
  clockOffset,
  reconnecting,
}: {
  amountUsdCents: number;
  invoice: string;
  expiresAt: string;
  clockOffset: number;
  reconnecting: boolean;
}) {
  const now = useNow();
  const remaining = Date.parse(expiresAt) - (now + clockOffset);
  return (
    <PayShell
      footer={
        <a href={`https://cash.app/launch/lightning/${invoice}`} className={primaryActionClass}>
          <Lock aria-hidden="true" className="size-4" strokeWidth={2.4} />
          Pay with Cash App →
        </a>
      }
    >
      {reconnecting ? <ReconnectingBanner /> : null}
      <AmountCard amountUsdCents={amountUsdCents}>
        <span
          role="status"
          className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-pay-pill px-3 text-[13px] font-extrabold text-pay-text"
        >
          <span
            aria-hidden="true"
            className="size-[7px] rounded-full bg-pay-brand motion-safe:animate-pulse"
          />
          Awaiting payment
        </span>
        <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-[#f3f4f6] px-2.5 text-[13px] font-extrabold text-[#374151]">
          <Timer aria-hidden="true" className="size-3.5" strokeWidth={2.4} />
          <span className="sr-only">Expires in </span>
          <span className="tabular-nums">{formatCountdown(remaining)}</span>
        </span>
      </AmountCard>
      <div className="flex flex-col items-center gap-3.5 rounded-[18px] bg-pay-panel px-4 pt-[18px] pb-4">
        <InvoiceQr invoice={invoice} />
        <CopyInvoice invoice={invoice} />
      </div>
    </PayShell>
  );
}

function InvoiceQr({ invoice }: { invoice: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    // Uppercase BOLT11 encodes in QR alphanumeric mode: a smaller, easier-to-scan code.
    QRCode.toString(invoice.toUpperCase(), {
      type: "svg",
      errorCorrectionLevel: "Q",
      margin: 0,
      color: { dark: "#182032", light: "#ffffff" },
    })
      .then((markup) => active && setSvg(markup))
      .catch(() => active && setSvg(null));
    return () => {
      active = false;
    };
  }, [invoice]);
  return (
    <div className="relative rounded-[14px] border border-pay-edge bg-white p-3">
      {svg ? (
        <img
          src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
          alt="Lightning invoice QR code"
          className="size-56"
        />
      ) : (
        <Skeleton className="size-56" />
      )}
      <span
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 flex size-10 -translate-1/2 items-center justify-center rounded-[10px] border-4 border-white bg-pay-brand text-white"
      >
        <Zap className="size-[18px] fill-current" strokeWidth={1.5} />
      </span>
    </div>
  );
}

function CopyInvoice({ invoice }: { invoice: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 1800);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <div className="flex h-12 w-full items-center gap-2 rounded-full border border-pay-edge bg-white pr-1.5 pl-[17px]">
      <p className="min-w-0 flex-1 truncate font-mono text-[13px] text-[#374151]">
        <span className="sr-only">Invoice </span>
        {invoice}
      </p>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(invoice).then(
            () => setState("copied"),
            () => setState("failed"),
          );
        }}
        className={
          state === "copied"
            ? "inline-flex h-9 items-center gap-1.5 rounded-full bg-pay-action px-3.5 text-[13px] font-black text-white"
            : "inline-flex h-9 items-center gap-1.5 rounded-full bg-pay-toggle px-3.5 text-[13px] font-black text-pay-text-strong"
        }
      >
        {state === "copied" ? (
          <Check aria-hidden="true" className="size-3.5" strokeWidth={2.8} />
        ) : (
          <Copy aria-hidden="true" className="size-3.5" strokeWidth={2.4} />
        )}
        <span aria-live="polite">
          {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
        </span>
      </button>
    </div>
  );
}

function PaidView({
  amountUsdCents,
  orderId,
  merchantSlug,
}: {
  amountUsdCents: number;
  orderId: string;
  merchantSlug?: string;
}) {
  return (
    <PayShell>
      <section
        role="status"
        className="flex flex-col items-center gap-3 rounded-[18px] bg-pay-panel px-5 pt-9 pb-7 text-center"
      >
        <span className="flex size-[72px] items-center justify-center rounded-full bg-pay-brand text-white shadow-[0_12px_24px_rgba(56,189,73,0.24)]">
          <Check aria-hidden="true" className="size-9" strokeWidth={3} />
        </span>
        <h1 className="mt-1 text-2xl font-black tracking-tight">Payment received</h1>
        <p className="text-[15px] font-bold text-[#4b5563]">You can close this page.</p>
      </section>
      <dl className="rounded-[18px] border border-pay-line px-5 py-1">
        <div className="flex items-center justify-between border-b border-[#eef1f5] py-[15px]">
          <dt className="text-sm font-bold text-pay-muted">Amount</dt>
          <dd className="text-base font-black">{formatUsd(amountUsdCents)}</dd>
        </div>
        {merchantSlug ? (
          <div className="flex items-center justify-between gap-4 border-b border-[#eef1f5] py-[15px]">
            <dt className="text-sm font-bold text-pay-muted">Paid to</dt>
            <dd className="truncate text-[15px] font-extrabold">{merchantSlug}</dd>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-4 py-[15px]">
          <dt className="text-sm font-bold text-pay-muted">Order</dt>
          <dd className="font-mono text-[13px] text-[#374151]">
            <abbr title={orderId} className="no-underline">
              {orderId.slice(0, 8)}…{orderId.slice(-4)}
            </abbr>
          </dd>
        </div>
      </dl>
    </PayShell>
  );
}

function NewInvoiceAction({ href }: { href?: string }) {
  return href ? (
    <a href={href} className={primaryActionClass}>
      <RotateCcw aria-hidden="true" className="size-4" strokeWidth={2.4} />
      Get a new invoice
    </a>
  ) : (
    <p className="text-center text-[13px] font-bold text-pay-muted">
      Ask the merchant for the payment link to start again.
    </p>
  );
}

function ExpiredView({
  amountUsdCents,
  newInvoiceHref,
  reconnecting,
}: {
  amountUsdCents: number;
  newInvoiceHref?: string;
  reconnecting: boolean;
}) {
  return (
    <PayShell footer={<NewInvoiceAction href={newInvoiceHref} />}>
      {reconnecting ? <ReconnectingBanner /> : null}
      <AmountCard amountUsdCents={amountUsdCents} muted>
        <span className="inline-flex h-[26px] items-center rounded-full bg-[#f3f4f6] px-3 text-[13px] font-extrabold text-[#374151]">
          Expired
        </span>
      </AmountCard>
      <section className="flex flex-col items-center gap-2.5 rounded-[18px] bg-pay-surface px-5 py-7 text-center">
        <span className="flex size-14 items-center justify-center rounded-full border border-pay-line bg-white text-[#4b5563]">
          <Timer aria-hidden="true" className="size-[26px]" strokeWidth={2.2} />
        </span>
        <h1 className="text-lg font-black">This invoice has expired</h1>
        <p className="max-w-[290px] text-sm leading-relaxed font-bold text-[#4b5563]">
          Don't pay this invoice. Start again to get a new one at the current price.
        </p>
      </section>
      <div className="flex items-start gap-2.5 rounded-[14px] border border-pay-line px-3.5 py-3">
        <Info
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-[#374151]"
          strokeWidth={2.2}
        />
        <p className="text-[13px] leading-normal font-bold text-[#374151]">
          Paid just before it expired? Keep this page open — it updates if the payment arrives.
        </p>
      </div>
    </PayShell>
  );
}

function FailedView({ newInvoiceHref }: { newInvoiceHref?: string }) {
  return (
    <PayShell footer={<NewInvoiceAction href={newInvoiceHref} />}>
      <section className="flex flex-1 flex-col items-center justify-center gap-3 rounded-[18px] bg-pay-surface px-6 py-10 text-center">
        <h1 className="text-[22px] font-black tracking-tight">This invoice couldn't be created</h1>
        <p className="max-w-[300px] text-[15px] leading-relaxed font-bold text-[#4b5563]">
          Nothing was charged. Start again to get a new invoice.
        </p>
      </section>
    </PayShell>
  );
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
