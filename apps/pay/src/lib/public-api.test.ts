import type { Query } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { orderPollInterval, POLL_AFTER_EXPIRY_MS } from "../modules/payment/invoice-page";
import { createOrder, type PublicOrderData } from "./public-api";

const order = (expiresAt: number, status: PublicOrderData["status"]): PublicOrderData => ({
  id: "12345678-1234-4234-8234-123456789abc",
  merchantId: "12345678-1234-4234-8234-123456789abd",
  amountUsdCents: 1000,
  amountSat: 10000,
  status,
  invoice: "lnbc100u1test",
  expiresAt: new Date(expiresAt).toISOString(),
  serverTime: new Date().toISOString(),
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("an order still being invoiced is retried with the same idempotency key", async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ code: "ORDER_IN_PROGRESS", message: "ORDER_IN_PROGRESS" }, { status: 409 }),
    )
    .mockResolvedValueOnce(Response.json(order(Date.now() + 3_600_000, "pending")));
  vi.stubGlobal("fetch", fetcher);
  const created = createOrder("onne", { amountUsdCents: 1000 }, "key-0000000000000001");
  await vi.advanceTimersByTimeAsync(1_000);
  expect((await created).status).toBe("pending");
  expect(fetcher).toHaveBeenCalledTimes(2);
  const keys = fetcher.mock.calls.map(([, init]) =>
    new Headers(init?.headers).get("idempotency-key"),
  );
  expect(keys).toEqual(["key-0000000000000001", "key-0000000000000001"]);
});

test("an expired order is polled until ten minutes past expiry, then polling stops", () => {
  const query = (data: PublicOrderData) =>
    ({
      state: { data, error: null, fetchFailureCount: 0, dataUpdatedAt: Date.now() },
    }) as unknown as Query<PublicOrderData, Error>;
  expect(orderPollInterval(query(order(Date.now() - 60_000, "expired")))).toBe(15_000);
  expect(
    orderPollInterval(query(order(Date.now() - POLL_AFTER_EXPIRY_MS - 1_000, "expired"))),
  ).toBe(false);
});
