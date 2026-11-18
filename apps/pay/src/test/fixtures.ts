import { vi } from "vite-plus/test";

export const MERCHANT_ID = "11111111-1111-4111-8111-111111111111";
export const ORDER_ID = "12345678-1234-4234-8234-123456789abc";
export const INVOICE =
  "lnbc274u1pn9x7qkpp5q8e3f9a1c0e7b52d84e6a10f3c9b2e7d58a41c06f9e2b3d7a85c1e4f6";

export function merchant(enabled = true) {
  return {
    merchantId: MERCHANT_ID,
    slug: "onne",
    enabled,
    currency: "USD",
    minAmountUsdCents: 1000,
    maxAmountUsdCents: 30000,
  };
}

export function order(status: "creating" | "pending" | "paid" | "expired" | "failed") {
  const now = new Date();
  return {
    id: ORDER_ID,
    merchantId: MERCHANT_ID,
    amountUsdCents: 2500,
    amountSat: 27400,
    status,
    invoice: status === "creating" ? null : INVOICE,
    expiresAt: status === "creating" ? null : new Date(now.getTime() + 52 * 60_000).toISOString(),
    serverTime: now.toISOString(),
  };
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Routes `fetch` calls to handlers by method and path; records every call. */
export function stubFetch(
  handlers: Record<string, (init: RequestInit | undefined) => Response | Promise<Response>>,
) {
  const calls: { key: string; init: RequestInit | undefined }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    calls.push({ key, init });
    const handler = handlers[key];
    if (!handler) throw new Error(`Unexpected fetch ${key}`);
    return handler(init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}
