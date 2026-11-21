import { Alert, AlertDescription, AlertTitle } from "@btc-lightning-pay/ui/components/alert";
import { Button } from "@btc-lightning-pay/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@btc-lightning-pay/ui/components/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@btc-lightning-pay/ui/components/field";
import { Input } from "@btc-lightning-pay/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@btc-lightning-pay/ui/components/select";
import { Spinner } from "@btc-lightning-pay/ui/components/spinner";
import { toast } from "@btc-lightning-pay/ui/components/toast";
import { ToggleGroup, ToggleGroupItem } from "@btc-lightning-pay/ui/components/toggle-group";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import {
  AdminApiError,
  adminApi,
  describeAdminError,
  type PayoutData,
  type PayoutRouteData,
  type SettlementDetailData,
} from "../../lib/api/admin";
import { formatSats } from "../../lib/format";
import {
  addressProblem,
  compareNetworks,
  formatTokenUnits,
  networkName,
  satsToUsd,
  usdCentsToSats,
} from "../../lib/payout";
import { UsdApprox } from "./common";
import { btcQuoteQuery, payoutRoutesQuery, walletQuery } from "./queries";

type Asset = PayoutRouteData["asset"];

/** Seconds left until `iso`, ticking every second; 0 once it has passed. */
export function useSecondsLeft(iso: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [iso]);
  return iso ? Math.max(0, Math.floor((Date.parse(iso) - now) / 1000)) : 0;
}
export const formatCountdown = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

/** The route's limits in sats; dollar limits convert at the stored price, when there is one. */
function limitsOf(route: PayoutRouteData, rateUsd: string | undefined) {
  const fromUsd = (cents: number | null) =>
    cents !== null && rateUsd ? usdCentsToSats(cents, rateUsd) : null;
  const pick = (values: (number | null)[], choose: (...v: number[]) => number) => {
    const known = values.filter((value): value is number => value !== null);
    return known.length ? choose(...known) : null;
  };
  return {
    min: pick([route.minSat, fromUsd(route.minUsdCents)], Math.max),
    max: pick([route.maxSat, fromUsd(route.maxUsdCents)], Math.min),
  };
}

/**
 * Pays a pending settlement: pick a stablecoin and network, paste the address, get a quote, then
 * submit it. `quoted` resumes an open quote; `previous` prefills a retry. Render it only while
 * open, so each opening starts fresh.
 */
export function PayoutDialog({
  settlement,
  open,
  onClose,
  quoted,
  previous,
}: {
  settlement: SettlementDetailData;
  open: boolean;
  onClose: () => void;
  quoted?: PayoutData;
  previous?: PayoutData;
}) {
  const queryClient = useQueryClient();
  const routes = useQuery({ ...payoutRoutesQuery(), enabled: open });
  const wallet = useQuery({ ...walletQuery(), enabled: open });
  const price = useQuery(btcQuoteQuery());
  // Mounted fresh for each opening, so these start from the open quote or the last attempt.
  const start = quoted ?? previous;
  const [asset, setAsset] = useState<Asset>(start?.asset ?? "USDT");
  const [chain, setChain] = useState<string | null>(start?.chain ?? null);
  const [address, setAddress] = useState(start?.address ?? "");
  const [touched, setTouched] = useState(false);
  const [quote, setQuote] = useState<PayoutData | null>(quoted ?? null);
  const secondsLeft = useSecondsLeft(quote?.quoteExpiresAt ?? null);
  const addressId = useId();
  const networkId = useId();

  const networks = useMemo(
    () =>
      (routes.data?.routes ?? [])
        .filter((route) => route.asset === asset)
        .sort((a, b) => compareNetworks(a.chain, b.chain)),
    [routes.data, asset],
  );
  const route = networks.find((item) => item.chain === chain) ?? null;
  const limits = route ? limitsOf(route, price.data?.rateUsd) : null;
  const amount = settlement.amountSat;
  const balance = wallet.data?.balanceSat;
  const trimmed = address.trim();

  const amountError =
    balance !== undefined && amount > balance
      ? "超过可用余额。"
      : route &&
          limits &&
          ((limits.min !== null && amount < limits.min) ||
            (limits.max !== null && amount > limits.max))
        ? `超出 ${networkName(route.chain)} 的范围。`
        : undefined;
  const addressError = route
    ? addressProblem(trimmed, route.addressFamily, route.chain)
    : undefined;

  const requestQuote = useMutation({
    mutationFn: () =>
      adminApi.quotePayout({
        params: { settlementId: settlement.id },
        payload: { chain: route!.chain, asset, address: trimmed },
      }),
    onSuccess: (payout) => {
      setQuote(payout);
      void queryClient.invalidateQueries({ queryKey: ["admin", "settlement", settlement.id] });
    },
  });
  const submit = useMutation({
    mutationFn: (payout: PayoutData) =>
      adminApi.submitPayout({ params: { settlementId: settlement.id, payoutId: payout.id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      toast.add({ title: "已提交打款", type: "success" });
      close();
    },
    onError: async (error) => {
      // The wallet may have sent it: never offer a resubmit; the settlement shows the outcome.
      if (error instanceof AdminApiError && error.code === "PAYOUT_OUTCOME_UNKNOWN") {
        await queryClient.invalidateQueries({ queryKey: ["admin"] });
        toast.add({
          title: "打款结果待确认",
          description: describeAdminError(error),
          type: "warning",
        });
        close();
      }
    },
  });

  function close() {
    requestQuote.reset();
    submit.reset();
    setTouched(false);
    onClose();
  }

  const busy = requestQuote.isPending || submit.isPending;
  const canQuote = route !== null && !amountError && !addressError && !busy;
  const expired = quote !== null && secondsLeft === 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>打款</DialogTitle>
        </DialogHeader>
        {quote ? (
          <QuoteView quote={quote} secondsLeft={secondsLeft} />
        ) : (
          <FieldGroup>
            <Field>
              <FieldLabel>币种</FieldLabel>
              <ToggleGroup
                variant="outline"
                spacing={0}
                value={[asset]}
                onValueChange={(next: unknown[]) => {
                  const value = next[0];
                  if (value === "USDT" || value === "USDC") {
                    setAsset(value);
                    setChain(null);
                  }
                }}
              >
                <ToggleGroupItem value="USDT" className="min-w-20">
                  USDT
                </ToggleGroupItem>
                <ToggleGroupItem value="USDC" className="min-w-20">
                  USDC
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor={networkId}>网络</FieldLabel>
              <Select
                value={chain ?? ""}
                onValueChange={(next) => setChain(next ? String(next) : null)}
                items={networks.map((item) => ({
                  value: item.chain,
                  label: networkName(item.chain),
                }))}
              >
                <SelectTrigger id={networkId} className="w-full" disabled={routes.isPending}>
                  <SelectValue placeholder={routes.isPending ? "加载中…" : "选择网络"} />
                </SelectTrigger>
                <SelectContent>
                  {networks.map((item) => (
                    <SelectItem key={item.chain} value={item.chain}>
                      {networkName(item.chain)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {routes.isError ? (
                <FieldError errors={[{ message: describeAdminError(routes.error) }]} />
              ) : null}
            </Field>
            <Field data-invalid={touched && addressError ? true : undefined}>
              <FieldLabel htmlFor={addressId}>收款地址</FieldLabel>
              <Input
                id={addressId}
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                onBlur={() => setTouched(true)}
                aria-invalid={touched && addressError ? true : undefined}
              />
              {touched && addressError ? <FieldError errors={[{ message: addressError }]} /> : null}
            </Field>
            <Field data-invalid={amountError ? true : undefined}>
              <FieldLabel>金额</FieldLabel>
              <div className="flex items-baseline gap-2 font-mono tabular-nums">
                <span className="text-lg font-semibold">{formatSats(amount)}</span>
                <span className="text-muted-foreground">sats</span>
                <UsdApprox sats={amount} className="font-sans text-sm text-muted-foreground" />
              </div>
              {amountError ? <FieldError errors={[{ message: amountError }]} /> : null}
              <FieldDescription>
                钱包余额 {balance === undefined ? "—" : `${formatSats(balance)} sats`}
                {route && limits ? (
                  <>
                    <br />
                    {rangeText(limits, price.data?.rateUsd)}
                  </>
                ) : null}
              </FieldDescription>
            </Field>
          </FieldGroup>
        )}
        {requestQuote.isError || (submit.isError && !isUnknown(submit.error)) ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>{requestQuote.isError ? "无法报价" : "提交失败"}</AlertTitle>
            <AlertDescription>
              {describeAdminError(requestQuote.error ?? submit.error)}
            </AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          {quote ? (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setQuote(null);
                  submit.reset();
                }}
              >
                返回修改
              </Button>
              {expired ? (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setQuote(null);
                    submit.reset();
                    if (route) requestQuote.mutate();
                  }}
                >
                  {requestQuote.isPending ? <Spinner data-icon="inline-start" /> : null}
                  重新报价
                </Button>
              ) : (
                <Button disabled={busy} onClick={() => submit.mutate(quote)}>
                  {submit.isPending ? <Spinner data-icon="inline-start" /> : null}
                  提交打款
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={close}>
                取消
              </Button>
              <Button
                disabled={!canQuote}
                onClick={() => {
                  setTouched(true);
                  requestQuote.mutate();
                }}
              >
                {requestQuote.isPending ? <Spinner data-icon="inline-start" /> : null}
                获取报价
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const isUnknown = (error: unknown) =>
  error instanceof AdminApiError && error.code === "PAYOUT_OUTCOME_UNKNOWN";

function rangeText(
  limits: { min: number | null; max: number | null },
  rateUsd: string | undefined,
) {
  const usd = (sats: number) => (rateUsd ? `约 ${satsToUsd(sats, rateUsd)}` : "");
  if (limits.min !== null && limits.max !== null)
    return `范围 ${formatSats(limits.min)} – ${formatSats(limits.max)} sats（${usd(limits.min)} – ${usd(limits.max)}）`;
  if (limits.min !== null) return `最小 ${formatSats(limits.min)} sats（${usd(limits.min)}）`;
  if (limits.max !== null) return `最大 ${formatSats(limits.max)} sats（${usd(limits.max)}）`;
  return "";
}

function QuoteView({ quote, secondsLeft }: { quote: PayoutData; secondsLeft: number }) {
  const expired = secondsLeft === 0;
  const units = (value: string) => `${formatTokenUnits(value, quote.decimals)} ${quote.asset}`;
  const dim = expired ? "text-muted-foreground" : "";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">打款到</span>
        <span className="text-xl font-semibold">
          {networkName(quote.chain)} · {quote.asset}
        </span>
        <span className="font-mono text-sm break-all">{quote.address}</span>
      </div>
      <dl className={`flex flex-col gap-2 text-sm tabular-nums ${dim}`}>
        <Row label="从钱包转出">{formatSats(quote.amountSat)} sats</Row>
        <Row label="折算">{units(quote.valueOut)}</Row>
        <Row label="手续费">−{units(quote.feeOut)}</Row>
        <div className="flex items-baseline justify-between gap-4 border-t pt-3">
          <dt className="font-medium">预计到账</dt>
          <dd className="text-xl font-semibold">{units(quote.estimatedOut)}</dd>
        </div>
        <Row label="服务商">{quote.provider === "orchestra" ? "Orchestra" : "Boltz"}</Row>
        <Row label="报价有效期">
          <span
            className={secondsLeft <= 10 && !expired ? "text-warning-foreground font-medium" : ""}
          >
            {formatCountdown(secondsLeft)}
          </span>
        </Row>
      </dl>
      {expired ? (
        <p className="text-sm text-muted-foreground" role="status">
          报价已过期，请重新报价。
        </p>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
