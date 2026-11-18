import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleDollarSign, Lock, Zap } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Skeleton } from "@btc-lightning-pay/ui/components/skeleton";
import { Spinner } from "@btc-lightning-pay/ui/components/spinner";
import { PRESET_AMOUNTS_USD, formatUsd, parseUsdAmount } from "../../lib/amount";
import { PublicApiError, createOrder, getMerchant } from "../../lib/public-api";
import { PayShell, primaryActionClass } from "./pay-shell";
import { UnavailableScreen } from "./unavailable-screen";

const COLLAPSED_COUNT = 6;

export function merchantQueryOptions(slug: string) {
  return {
    queryKey: ["public-merchant", slug] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => getMerchant(slug, signal),
    retry: (failures: number, error: Error) =>
      error instanceof PublicApiError && error.retryable && failures < 2,
    staleTime: 30_000,
  };
}

export function AmountPage({
  slug,
  onOrderCreated,
}: {
  slug: string;
  onOrderCreated: (orderId: string) => void;
}) {
  const merchant = useQuery(merchantQueryOptions(slug));

  if (merchant.isPending) return <AmountSkeleton />;
  if (merchant.isError) {
    const error = merchant.error;
    if (error instanceof PublicApiError && error.status === 404) {
      return <UnavailableScreen variant="notfound" />;
    }
    return <UnavailableScreen variant="offline" onRetry={() => void merchant.refetch()} />;
  }
  if (!merchant.data.enabled) return <UnavailableScreen variant="disabled" />;
  return <AmountForm slug={slug} onOrderCreated={onOrderCreated} />;
}

function AmountForm({
  slug,
  onOrderCreated,
}: {
  slug: string;
  onOrderCreated: (orderId: string) => void;
}) {
  const [preset, setPreset] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [disabled, setDisabled] = useState(false);
  // One payer submission keeps one idempotency key, so a retry never opens a second order.
  const attempt = useRef<{ cents: number; key: string } | null>(null);
  const customId = useId();
  const errorId = useId();

  const parsed = custom.trim() === "" ? null : parseUsdAmount(custom);
  const cents = parsed ? (parsed.ok ? parsed.cents : null) : preset === null ? null : preset * 100;
  const inputError = parsed && !parsed.ok ? parsed.error : "";

  const submit = useMutation({
    mutationFn: async (amountUsdCents: number) => {
      if (!attempt.current || attempt.current.cents !== amountUsdCents) {
        attempt.current = { cents: amountUsdCents, key: crypto.randomUUID() };
      }
      return createOrder(slug, { amountUsdCents }, attempt.current.key);
    },
    onSuccess: (order) => {
      attempt.current = null;
      onOrderCreated(order.id);
    },
    onError: (error) => {
      if (!(error instanceof PublicApiError)) return;
      if (error.code === "MERCHANT_DISABLED") setDisabled(true);
      // The backend saw this key with different content; the next try must start fresh.
      if (error.code === "IDEMPOTENCY_CONFLICT" || error.status === 400) attempt.current = null;
    },
  });

  if (disabled) return <UnavailableScreen variant="disabled" />;

  const amounts = expanded ? PRESET_AMOUNTS_USD : PRESET_AMOUNTS_USD.slice(0, COLLAPSED_COUNT);
  const submitError = submit.isError ? describeSubmitError(submit.error) : "";
  const busy = submit.isPending;

  return (
    <PayShell
      footer={
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (cents !== null && !busy) submit.mutate(cents);
          }}
          className="flex flex-col gap-3"
        >
          {submitError ? (
            <p role="alert" className="text-center text-[13px] font-bold text-pay-danger">
              {submitError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={cents === null || busy}
            aria-busy={busy}
            className={primaryActionClass}
          >
            {busy ? (
              <Spinner aria-hidden="true" className="size-4" />
            ) : (
              <Lock aria-hidden="true" className="size-4" strokeWidth={2.4} />
            )}
            {cents === null
              ? "Choose an amount"
              : busy
                ? "Creating invoice…"
                : `Pay ${formatUsd(cents)} →`}
          </button>
        </form>
      }
    >
      <div className="flex flex-col items-center gap-0.5 rounded-[18px] border border-pay-line p-[22px]">
        {/* Replace the tile with the official Cash App mark once usage is cleared. */}
        <span className="mb-2.5 flex size-10 items-center justify-center rounded-lg bg-pay-brand text-white">
          <Zap aria-hidden="true" className="size-6 fill-current" strokeWidth={1.5} />
        </span>
        <p className="text-base font-black">Cash App</p>
        <p className="text-[13.5px] font-bold text-pay-muted">Instant</p>
      </div>
      <section
        aria-labelledby="amount-title"
        className="flex flex-col gap-3.5 rounded-[18px] bg-pay-panel px-4 pt-5 pb-4"
      >
        <h1
          id="amount-title"
          className="flex items-center gap-2 text-[12.5px] font-black tracking-wide text-pay-text uppercase"
        >
          <CircleDollarSign aria-hidden="true" className="size-4" />
          Select amount
        </h1>
        <div role="group" aria-labelledby="amount-title" className="grid grid-cols-3 gap-2.5">
          {amounts.map((usd) => {
            const selected = custom.trim() === "" && preset === usd;
            return (
              <button
                key={usd}
                type="button"
                aria-pressed={selected}
                disabled={busy}
                onClick={() => {
                  setPreset(usd);
                  setCustom("");
                  submit.reset();
                }}
                className={
                  selected
                    ? "h-11 rounded-full border-2 border-pay-focus bg-[#f0fdf2] text-[15px] font-black text-[#157a31]"
                    : "h-11 rounded-full border border-pay-edge bg-white text-[15px] font-black text-[#1a2232] shadow-[0_1px_0_rgba(45,177,75,0.04)] hover:border-pay-focus"
                }
              >
                ${usd}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="h-9 rounded-full bg-pay-toggle text-[13px] font-black text-pay-text-strong"
        >
          {expanded ? "Show fewer amounts ▲" : "Show more amounts ▼"}
        </button>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={customId} className="sr-only">
            Custom amount in USD
          </label>
          <div
            className={`flex h-14 items-center gap-2 rounded-full border bg-white px-[17px] focus-within:ring-3 focus-within:ring-pay-focus/40 ${
              inputError ? "border-pay-danger" : custom ? "border-pay-focus" : "border-[#bcebc7]"
            }`}
          >
            <span aria-hidden="true" className="text-[17px] font-black text-pay-text">
              $
            </span>
            <input
              id={customId}
              inputMode="decimal"
              autoComplete="off"
              placeholder="Custom amount"
              value={custom}
              disabled={busy}
              aria-invalid={inputError ? true : undefined}
              aria-describedby={inputError ? errorId : undefined}
              onChange={(event) => {
                setCustom(event.target.value);
                submit.reset();
              }}
              className="min-w-0 flex-1 bg-transparent text-[15px] font-black outline-none placeholder:font-bold placeholder:text-pay-muted"
            />
          </div>
          {inputError ? (
            <p
              id={errorId}
              role="alert"
              className="px-[17px] text-[13px] font-bold text-pay-danger"
            >
              {inputError}
            </p>
          ) : null}
        </div>
      </section>
    </PayShell>
  );
}

function describeSubmitError(error: Error) {
  if (!(error instanceof PublicApiError)) return "Something went wrong. Please try again.";
  switch (error.code) {
    case "QUOTE_UNAVAILABLE":
      return "We couldn't get a live BTC price. Try again in a minute — nothing was charged.";
    case "RATE_LIMITED":
      return "Too many requests right now. Try again in a moment.";
    case "INVALID_INPUT":
      return "Enter an amount from $10.00 to $300.00.";
    case "IDEMPOTENCY_CONFLICT":
      return "Please try again.";
    default:
      return error.retryable
        ? "Can't reach the payment service. Try again — you won't get a duplicate invoice."
        : "Something went wrong. Please try again.";
  }
}

function AmountSkeleton() {
  return (
    <PayShell>
      <div
        aria-busy="true"
        aria-label="Loading"
        className="flex flex-col gap-3.5 rounded-[18px] bg-pay-panel px-4 pt-5 pb-4"
      >
        <Skeleton className="h-4 w-32 bg-white" />
        <div className="grid grid-cols-3 gap-2.5">
          {PRESET_AMOUNTS_USD.slice(0, COLLAPSED_COUNT).map((usd) => (
            <Skeleton key={usd} className="h-11 rounded-full bg-white" />
          ))}
        </div>
        <Skeleton className="h-14 rounded-full bg-white" />
      </div>
    </PayShell>
  );
}
