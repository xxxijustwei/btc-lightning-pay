import { Ban, RotateCcw, Search, TrendingUp, WifiOff } from "lucide-react";
import { PayShell, primaryActionClass } from "./pay-shell";

type Variant = "disabled" | "notfound" | "quote" | "offline";

const copy: Record<Variant, { title: string; body: string; icon: typeof Ban; retry?: string }> = {
  disabled: {
    title: "This payment link is paused",
    body: "The merchant is not accepting new payments right now. Nothing was charged.",
    icon: Ban,
  },
  notfound: {
    title: "Payment link not found",
    body: "Check the link with the merchant.",
    icon: Search,
  },
  quote: {
    title: "Pricing is temporarily unavailable",
    body: "We couldn't get a live BTC price, so no invoice was created. Try again in a minute.",
    icon: TrendingUp,
    retry: "Try again",
  },
  offline: {
    title: "Can't reach the payment service",
    body: "Check your connection and try again. Nothing was charged.",
    icon: WifiOff,
    retry: "Try again",
  },
};

export function UnavailableScreen({
  variant,
  onRetry,
}: {
  variant: Variant;
  onRetry?: () => void;
}) {
  const { title, body, icon: Icon, retry } = copy[variant];
  return (
    <PayShell
      footer={
        retry && onRetry ? (
          <button type="button" onClick={onRetry} className={primaryActionClass}>
            <RotateCcw aria-hidden="true" className="size-4" strokeWidth={2.4} />
            {retry}
          </button>
        ) : null
      }
    >
      <section
        aria-labelledby="unavailable-title"
        className="flex flex-1 flex-col items-center justify-center gap-3 rounded-[18px] bg-pay-surface px-6 py-10 text-center"
      >
        <span className="mb-1 flex size-16 items-center justify-center rounded-full border border-pay-line bg-white text-[#374151]">
          <Icon aria-hidden="true" className="size-7" strokeWidth={2.2} />
        </span>
        <h1 id="unavailable-title" className="max-w-[300px] text-[22px] font-black tracking-tight">
          {title}
        </h1>
        <p className="max-w-[300px] text-[15px] leading-relaxed font-bold text-[#4b5563]">{body}</p>
      </section>
    </PayShell>
  );
}
