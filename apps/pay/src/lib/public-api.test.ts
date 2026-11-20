import { afterEach, expect, test, vi } from "vite-plus/test";
import { publicApi, PublicApiError, type PublicOrderData } from "./public-api";

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

const MERCHANT = {
  merchantId: "12345678-1234-4234-8234-123456789abd",
  slug: "onne",
  enabled: true,
  currency: "USD",
  minAmountUsdCents: 100,
  maxAmountUsdCents: 30000,
};
const failureOf = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected the call to fail");
    },
    (cause: unknown) => cause as PublicApiError,
  );
const stubOnce = (response: () => Response | Promise<Response>) => {
  const fetcher = vi.fn<typeof fetch>(async () => response());
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};

test("an order is created from the contract's path, key header and payload, without credentials", async () => {
  const fetcher = stubOnce(() => Response.json(order(Date.now() + 3_600_000, "pending")));
  await publicApi.createOrder({
    params: { slug: "onne" },
    headers: { "idempotency-key": "key-0000000000000001" },
    payload: { amountUsdCents: 1000 },
  });
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe("/api/public/merchants/onne/orders");
  expect(init?.method).toBe("POST");
  expect(init?.credentials).toBeUndefined();
  expect(JSON.parse(String(init?.body))).toEqual({ amountUsdCents: 1000 });
  expect(new Headers(init?.headers).get("idempotency-key")).toBe("key-0000000000000001");
});

test("a slug the contract forbids is refused before any request", async () => {
  const fetcher = stubOnce(() => Response.json(MERCHANT));
  const error = await failureOf(publicApi.merchant({ params: { slug: "../admin" } }));
  expect(error).toMatchObject({ code: "INVALID_INPUT", retryable: false });
  expect(fetcher).not.toHaveBeenCalled();
});

test("failures carry a contract or client code and say whether to retry", async () => {
  stubOnce(() =>
    Response.json({ code: "MERCHANT_NOT_FOUND", message: "Not found" }, { status: 404 }),
  );
  expect(await failureOf(publicApi.merchant({ params: { slug: "onne" } }))).toMatchObject({
    code: "MERCHANT_NOT_FOUND",
    retryable: false,
  });

  stubOnce(() => new Response("", { status: 404 }));
  expect(await failureOf(publicApi.merchant({ params: { slug: "onne" } }))).toMatchObject({
    code: "UNEXPECTED_RESPONSE",
    retryable: false,
  });

  stubOnce(() => Response.json({ code: "BACKEND_UNAVAILABLE", message: "down" }, { status: 502 }));
  expect(await failureOf(publicApi.merchant({ params: { slug: "onne" } }))).toMatchObject({
    code: "BACKEND_UNAVAILABLE",
    retryable: true,
    outcomeUnknown: true,
  });

  stubOnce(() => Promise.reject(new TypeError("Failed to fetch")));
  expect(await failureOf(publicApi.merchant({ params: { slug: "onne" } }))).toMatchObject({
    code: "NETWORK",
    retryable: true,
    outcomeUnknown: true,
  });
});

test("a request with no answer times out after 15 seconds; the caller's cancel passes through", async () => {
  const hang = vi.fn<typeof fetch>(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );
  vi.stubGlobal("fetch", hang);
  vi.useFakeTimers();
  const timedOut = failureOf(publicApi.order({ params: { orderId: order(0, "paid").id } }));
  await vi.advanceTimersByTimeAsync(15_000);
  expect(await timedOut).toMatchObject({ code: "TIMEOUT", retryable: true });

  const controller = new AbortController();
  const cancelled = failureOf(
    publicApi.order({ params: { orderId: order(0, "paid").id } }, { signal: controller.signal }),
  );
  controller.abort(new DOMException("left", "AbortError"));
  expect(await cancelled).not.toBeInstanceOf(PublicApiError);
});
