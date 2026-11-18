import { Schema } from "effect";
import { UpstreamFailure } from "./errors";

const Rate = Schema.String.check(Schema.isPattern(/^[0-9]{1,12}(\.[0-9]{1,8})?$/));
const Price = Schema.Struct({
  data: Schema.Struct({ amount: Rate, currency: Schema.Literal("USD") }),
});
export function quoteSats(cents: number, price: string): number {
  const rate = Schema.decodeUnknownSync(Rate)(price);
  const [whole, fraction = ""] = rate.split(".");
  const denominator = BigInt(whole + fraction);
  if (denominator <= 0n || !Number.isInteger(cents) || cents < 100 || cents > 30000)
    throw new Error("Invalid quote");
  const numerator = BigInt(cents) * 1_000_000n * 10n ** BigInt(fraction.length);
  const sats = (numerator + denominator - 1n) / denominator;
  if (sats < 1n || sats > 9_007_199_254_740n) throw new Error("Invalid quote");
  return Number(sats);
}
export function createQuoteSource(fetcher: typeof fetch = fetch, now = Date.now) {
  let cached: { rateUsd: string; quotedAt: Date } | undefined;
  return async (signal?: AbortSignal) => {
    if (cached && now() - cached.quotedAt.getTime() < 60_000) return cached;
    let response: Response;
    try {
      response = await fetcher("https://api.coinbase.com/v2/prices/BTC-USD/spot", {
        redirect: "manual",
        signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5000)]),
        cache: "no-store",
      });
    } catch (error) {
      throw new UpstreamFailure({
        dependency: "coinbase",
        reason: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network",
      });
    }
    if (!response.ok)
      throw new UpstreamFailure({
        dependency: "coinbase",
        reason: "http",
        upstreamStatus: response.status,
      });
    let value;
    try {
      value = Schema.decodeUnknownSync(Price)(await response.json());
      quoteSats(100, value.data.amount);
    } catch {
      throw new UpstreamFailure({ dependency: "coinbase", reason: "invalid_response" });
    }
    cached = { rateUsd: value.data.amount, quotedAt: new Date(now()) };
    return cached;
  };
}
