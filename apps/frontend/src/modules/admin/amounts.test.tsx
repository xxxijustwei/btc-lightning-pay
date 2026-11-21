import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vite-plus/test";
import { CurrentValue, SettlementAmount } from "./common";
import { btcQuoteQuery } from "./queries";

function withQuote(ui: React.ReactNode, rateUsd?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  if (rateUsd)
    client.setQueryData(btcQuoteQuery().queryKey, {
      rateUsd,
      source: "coinbase",
      quotedAt: "2026-11-21T08:00:00.000Z",
    });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
const base = { amountSat: 361_690, amountUsdCents: 33100, delivered: null };

test("an unpaid settlement leads with its current value, the original price underneath", () => {
  withQuote(<SettlementAmount settlement={{ ...base, status: "pending" }} />, "91000");
  expect(screen.getByText("≈ $329.14").getAttribute("title")).toContain(
    "1 BTC ≈ $91,000 · Coinbase",
  );
  expect(screen.getByText("361,690 sats · 原价 $331.00")).toBeTruthy();
});

test("a settled batch leads with what the merchant received", () => {
  withQuote(
    <SettlementAmount
      settlement={{
        ...base,
        status: "settled",
        delivered: { asset: "USDC", decimals: 6, deliveredOut: "327410000" },
      }}
    />,
    "91000",
  );
  expect(screen.getByText("327.41 USDC")).toBeTruthy();
  expect(screen.getByText("361,690 sats · 原价 $331.00")).toBeTruthy();
  // A fact never carries a current-price estimate.
  expect(screen.queryByText(/≈/)).toBeNull();
});

test("a cancelled batch shows its original price, and no price shows no estimate", () => {
  withQuote(<SettlementAmount settlement={{ ...base, status: "cancelled" }} />);
  expect(screen.getByText("$331.00")).toBeTruthy();
  expect(screen.getByText("361,690 sats")).toBeTruthy();
  withQuote(<CurrentValue sats={1000} />);
  expect(screen.getByText("≈ —")).toBeTruthy();
});
