import { expect, test, vi } from "vite-plus/test";
import { createQuoteSource, quoteSats } from "./quote";

test("USD cents convert exactly to sats, rounding upward once", () => {
  expect(quoteSats(1500, "100000")).toBe(15000);
  expect(quoteSats(1000, "60000")).toBe(16667);
  expect(quoteSats(1001, "99999.99999999")).toBe(10011);
  for (const [cents, price] of [
    [999, "100000"],
    [30001, "100000"],
    [1000.1, "100000"],
    [1000, "0"],
    [1000, "1e5"],
    [1000, "0.00000001"],
  ] as const)
    expect(() => quoteSats(cents, price)).toThrow();
});
test("price cache expires at 60 seconds and never serves a stale quote on upstream failure", async () => {
  let now = 0;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ data: { amount: "100000", currency: "USD" } }));
  const quote = createQuoteSource(fetcher, () => now);
  const first = await quote();
  now = 59999;
  expect(await quote()).toBe(first);
  expect(fetcher).toHaveBeenCalledTimes(1);
  now = 60000;
  fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
  await expect(quote()).rejects.toThrow();
  fetcher.mockResolvedValueOnce(Response.json({ data: { amount: "90000", currency: "USD" } }));
  expect(await quote()).toMatchObject({ rateUsd: "90000", quotedAt: new Date(now) });
});
