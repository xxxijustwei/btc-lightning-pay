import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, CircleDollarSign, Lock } from "lucide-react";
import { useId, useState } from "react";
import { Skeleton } from "@btc-lightning-pay/ui/components/skeleton";
import { Spinner } from "@btc-lightning-pay/ui/components/spinner";
import {
  AMOUNT_RANGE_ERROR,
  PRESET_AMOUNTS_USD,
  formatUsd,
  parseUsdAmount,
} from "../../lib/amount";
import { PublicApiError, orderQueryKey, publicApi } from "../../lib/public-api";
import { useOrderIntake } from "./order-intake";
import { PayShell, primaryActionClass } from "./pay-shell";
import { UnavailableScreen } from "./unavailable-screen";

const COLLAPSED_COUNT = 6;

export function merchantQueryOptions(slug: string) {
  return {
    queryKey: ["public-merchant", slug] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      publicApi.merchant({ params: { slug } }, { signal }),
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
    if (error instanceof PublicApiError && error.code === "MERCHANT_NOT_FOUND") {
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
  const queryClient = useQueryClient();
  const [preset, setPreset] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const customId = useId();
  const moreId = useId();
  const errorId = useId();

  const parsed = custom.trim() === "" ? null : parseUsdAmount(custom);
  const cents = parsed ? (parsed.ok ? parsed.cents : null) : preset === null ? null : preset * 100;
  const inputError = parsed && !parsed.ok ? parsed.error : "";

  const submit = useOrderIntake(slug, {
    onSuccess: (order) => {
      // The order already carries its invoice: the invoice page shows it without refetching.
      queryClient.setQueryData(orderQueryKey(order.id), order);
      onOrderCreated(order.id);
    },
    onError: (error) => {
      if (error.code === "MERCHANT_DISABLED") setDisabled(true);
    },
  });

  const pick = (usd: number) => {
    setPreset(usd);
    setCustom("");
    submit.reset();
  };

  if (disabled) return <UnavailableScreen variant="disabled" />;

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
      <WalletCard />
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
        <div role="group" aria-labelledby="amount-title" className="pb-1">
          <div className="grid grid-cols-3 gap-2.5">
            {PRESET_AMOUNTS_USD.slice(0, COLLAPSED_COUNT).map((usd) => (
              <PresetButton
                key={usd}
                usd={usd}
                selected={custom.trim() === "" && preset === usd}
                disabled={busy}
                onPick={pick}
              />
            ))}
          </div>
          {/* The extra rows open by animating their track from 0fr to 1fr. The overflow clip is
              widened by 4px so focus rings and the selected border are not cut off. */}
          <div
            id={moreId}
            className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${
              expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            }`}
          >
            <div className="-mx-1 -mb-1 min-h-0 overflow-hidden px-1" inert={!expanded}>
              <div className="grid grid-cols-3 gap-2.5 pt-2.5 pb-1">
                {PRESET_AMOUNTS_USD.slice(COLLAPSED_COUNT).map((usd, index) => (
                  <div
                    key={usd}
                    // Opening staggers items 30ms apart; closing is quicker and all at once.
                    style={{ transitionDelay: expanded ? `${60 + index * 30}ms` : "0ms" }}
                    className={`transition-[opacity,transform] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none ${
                      expanded
                        ? "translate-y-0 scale-100 opacity-100 duration-240"
                        : "-translate-y-1.5 scale-[0.98] opacity-0 duration-140"
                    }`}
                  >
                    <PresetButton
                      usd={usd}
                      selected={custom.trim() === "" && preset === usd}
                      disabled={busy}
                      onPick={pick}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={moreId}
          onClick={() => setExpanded((value) => !value)}
          className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-pay-toggle text-[13px] font-black text-pay-text-strong ${pressClass}`}
        >
          {expanded ? "Show fewer amounts" : "Show more amounts"}
          <ChevronDown
            aria-hidden="true"
            strokeWidth={2.6}
            className={`size-3.5 transition-transform duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${
              expanded ? "rotate-180" : ""
            }`}
          />
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
    case "WALLET_UNAVAILABLE":
      return "Couldn't create the invoice. Please try again.";
    case "RATE_LIMITED":
      return "Too many requests right now. Try again in a moment.";
    case "INVALID_INPUT":
      return AMOUNT_RANGE_ERROR;
    case "IDEMPOTENCY_CONFLICT":
      return "Please try again.";
    case "ORDER_IN_PROGRESS":
      return "Your invoice is still being created. Try again in a moment.";
    default:
      return error.retryable
        ? "Can't reach the payment service. Try again — you won't get a duplicate invoice."
        : "Something went wrong. Please try again.";
  }
}

/** Light press feedback; reduced-motion users get none. */
const pressClass =
  "transition-transform duration-150 ease-[cubic-bezier(0.2,0.8,0.2,1)] active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100";

function PresetButton({
  usd,
  selected,
  disabled,
  onPick,
}: {
  usd: number;
  selected: boolean;
  disabled: boolean;
  onPick: (usd: number) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onPick(usd)}
      className={`h-11 w-full rounded-full text-[15px] font-black ${pressClass} ${
        selected
          ? "border-2 border-pay-focus bg-[#f0fdf2] text-[#157a31]"
          : "border border-pay-edge bg-white text-[#1a2232] shadow-[0_1px_0_rgba(45,177,75,0.04)] hover:border-pay-focus"
      }`}
    >
      ${usd}
    </button>
  );
}

/** Static payment-method card; it needs no merchant data, so it also shows while loading. */
function WalletCard() {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-[18px] border border-pay-line p-[22px]">
      <img src="/payment-logo.png" alt="" className="mb-2.5 size-10" />
      <p className="text-base font-black">Cash App</p>
      <p className="text-[13.5px] font-bold text-pay-muted">Instant</p>
    </div>
  );
}

const skeletonClass = "bg-white motion-reduce:animate-none";

/** Mirrors the amount form's layout, with all presets shown as the form opens expanded. */
function AmountSkeleton() {
  return (
    <PayShell
      footer={<Skeleton className="h-14 rounded-full bg-[#f3f4f6] motion-reduce:animate-none" />}
    >
      <WalletCard />
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading amounts"
        className="flex flex-col gap-3.5 rounded-[18px] bg-pay-panel px-4 pt-5 pb-4"
      >
        <Skeleton className={`h-4 w-32 rounded-lg ${skeletonClass}`} />
        <div className="grid grid-cols-3 gap-2.5">
          {PRESET_AMOUNTS_USD.map((usd) => (
            <Skeleton key={usd} className={`h-11 rounded-full ${skeletonClass}`} />
          ))}
        </div>
        <Skeleton className={`h-9 rounded-full ${skeletonClass}`} />
        <Skeleton className={`h-14 rounded-full ${skeletonClass}`} />
      </div>
    </PayShell>
  );
}
