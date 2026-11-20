import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, test, vi } from "vite-plus/test";
import { json, order } from "../../test/fixtures";
import { useOrderIntake } from "./order-intake";

/** Answers each order request with the next response and records the idempotency key it carried. */
function setup(responses: Array<() => Response | Promise<Response>>) {
  const keys: (string | null)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (_url, init) => {
      keys.push(new Headers(init?.headers).get("idempotency-key"));
      const next = responses.shift();
      if (!next) throw new Error("Unexpected order request");
      return next();
    }),
  );
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useOrderIntake("onne"), { wrapper });
  const submit = (cents: number) =>
    act(() =>
      result.current.mutateAsync(cents).then(
        () => "created",
        (error: { code: string }) => error.code,
      ),
    );
  return { keys, submit };
}

const offline = () => Promise.reject(new TypeError("Failed to fetch"));

test("a retry after an unknown outcome reuses the key; a new amount gets a new one", async () => {
  const { keys, submit } = setup([
    offline,
    () => json(order("pending")),
    () => json(order("pending")),
  ]);
  expect(await submit(2500)).toBe("NETWORK");
  expect(await submit(2500)).toBe("created");
  expect(await submit(5000)).toBe("created");
  expect(keys[0]).toBe(keys[1]);
  expect(keys[2]).not.toBe(keys[1]);
});

test("a definite refusal starts the next submission with a fresh key", async () => {
  const { keys, submit } = setup([
    () => json({ code: "RATE_LIMITED", message: "slow down" }, 429),
    () => json(order("pending")),
  ]);
  expect(await submit(2500)).toBe("RATE_LIMITED");
  expect(await submit(2500)).toBe("created");
  expect(keys[1]).not.toBe(keys[0]);
});

test("a successful order starts the next submission with a fresh key", async () => {
  const { keys, submit } = setup([() => json(order("pending")), () => json(order("pending"))]);
  await submit(2500);
  await submit(2500);
  expect(keys[1]).not.toBe(keys[0]);
});

test("an order still being invoiced is awaited with the same key", async () => {
  vi.useFakeTimers();
  const inProgress = () => json({ code: "ORDER_IN_PROGRESS", message: "ORDER_IN_PROGRESS" }, 409);
  const { keys, submit } = setup([inProgress, inProgress, () => json(order("pending"))]);
  const outcome = submit(2500);
  await act(() => vi.advanceTimersByTimeAsync(2_000));
  expect(await outcome).toBe("created");
  expect(keys).toHaveLength(3);
  expect(new Set(keys).size).toBe(1);
});

test("keys come from getRandomValues, so browsers without randomUUID can still pay", async () => {
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  const { keys, submit } = setup([() => json(order("pending"))]);
  expect(await submit(2500)).toBe("created");
  expect(keys[0]).toMatch(/^[0-9a-f]{32}$/);
});
