import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { useGenerateSettlement } from "./generate-settlement";

const MERCHANT_ID = "3b1f6c2e-8a4d-4e7b-9c05-2d6e81fa7c19";
const SETTLEMENT = {
  id: "c41e0b7d-2f6a-4c19-8e3d-5a07b91fa2f9",
  merchantId: MERCHANT_ID,
  status: "pending",
  amountSat: 361690,
  orderCount: 6,
  cutoffAt: "2026-11-17T10:05:12.348Z",
  createdAt: "2026-11-17T10:05:12.348Z",
  createdBy: "u1",
  proof: null,
  confirmedAt: null,
  confirmedBy: null,
  cancelReason: null,
  cancelledAt: null,
  cancelledBy: null,
  displayStatus: "pending",
  amountUsdCents: 1000,
  delivered: null,
};

/** Answers each settle request with the next response and records the idempotency key it carried. */
function setup(responses: Array<(init?: RequestInit) => Response | Promise<Response>>) {
  const keys: (string | null)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (_url, init) => {
      keys.push(new Headers(init?.headers).get("idempotency-key"));
      const next = responses.shift();
      if (!next) throw new Error("Unexpected settle request");
      return next(init);
    }),
  );
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useGenerateSettlement(MERCHANT_ID), { wrapper });
  const generate = () =>
    act(() =>
      result.current.mutateAsync().then(
        () => "generated",
        (error: { code: string }) => error.code,
      ),
    );
  return { keys, generate };
}

const created = () => Response.json(SETTLEMENT, { status: 201 });
/** A request that never answers; it fails only when its signal aborts. */
const hanging = (init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

afterEach(() => {
  vi.useRealTimers();
});

test("a retry after a lost response reuses the key and gets the same batch", async () => {
  const { keys, generate } = setup([
    () => Promise.reject(new TypeError("Failed to fetch")),
    created,
  ]);
  expect(await generate()).toBe("NETWORK");
  expect(await generate()).toBe("generated");
  expect(keys[1]).toBe(keys[0]);
});

test("a timed-out request keeps its key for the retry", async () => {
  vi.useFakeTimers();
  const { keys, generate } = setup([hanging, created]);
  const first = generate();
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  expect(await first).toBe("TIMEOUT");
  expect(await generate()).toBe("generated");
  expect(keys[1]).toBe(keys[0]);
});

test("a definite refusal or a success starts the next attempt with a fresh key", async () => {
  const { keys, generate } = setup([
    () => Response.json({ code: "NO_ELIGIBLE_ORDERS", message: "none" }, { status: 409 }),
    created,
    created,
  ]);
  expect(await generate()).toBe("NO_ELIGIBLE_ORDERS");
  expect(await generate()).toBe("generated");
  expect(await generate()).toBe("generated");
  expect(new Set(keys).size).toBe(3);
});

test("keys come from getRandomValues, so browsers without randomUUID still work", async () => {
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  const { keys, generate } = setup([created]);
  expect(await generate()).toBe("generated");
  expect(keys[0]).toMatch(/^[0-9a-f]{32}$/);
});
