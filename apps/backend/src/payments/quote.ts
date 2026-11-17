import { Schema } from "effect";

const Rate = Schema.String.check(Schema.isPattern(/^[0-9]{1,12}(\.[0-9]{1,8})?$/));
const Price = Schema.Struct({
  data: Schema.Struct({ amount: Rate, currency: Schema.Literal("USD") }),
});
export function quoteSats(cents: number, price: string): number {
  const rate = Schema.decodeUnknownSync(Rate)(price);
  const [whole, fraction = ""] = rate.split(".");
  const denominator = BigInt(whole + fraction);
  if (denominator <= 0n || !Number.isInteger(cents) || cents < 1000 || cents > 30000)
    throw new Error("Invalid quote");
  const numerator = BigInt(cents) * 1_000_000n * 10n ** BigInt(fraction.length);
  const sats = (numerator + denominator - 1n) / denominator;
  if (sats < 1n || sats > 9_007_199_254_740n) throw new Error("Invalid quote");
  return Number(sats);
}
export function createQuoteSource(fetcher: typeof fetch = fetch, now = Date.now) {
  let cached: { rateUsd: string; quotedAt: Date } | undefined;
  return async () => {
    if (cached && now() - cached.quotedAt.getTime() < 60_000) return cached;
    const response = await fetcher("https://api.coinbase.com/v2/prices/BTC-USD/spot", {
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Quote unavailable");
    const value = Schema.decodeUnknownSync(Price)(await response.json());
    quoteSats(1000, value.data.amount);
    cached = { rateUsd: value.data.amount, quotedAt: new Date(now()) };
    return cached;
  };
}
