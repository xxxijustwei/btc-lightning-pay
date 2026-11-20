import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { ORDER_ID, json, order } from "../../test/fixtures";
import { useOrderStatus } from "./order-status";

const MINUTE = 60_000;
let start = 0;

beforeEach(() => {
  vi.useFakeTimers();
  start = Date.now();
});
afterEach(() => {
  delete (document as { visibilityState?: unknown }).visibilityState;
});

/** An order as the backend reports it now; `serverAhead` shifts the server's clock. */
function reply(status: "pending" | "paid" | "expired", expiresInMs: number, serverAhead = 0) {
  const serverNow = Date.now() + serverAhead;
  return json({
    ...order(status),
    expiresAt: new Date(start + serverAhead + expiresInMs).toISOString(),
    serverTime: new Date(serverNow).toISOString(),
  });
}

/** Mounts the hook; every order request is answered by `answer` and its time is recorded. */
function mount(answer: (call: number) => Response | Promise<Response>) {
  const times: number[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      times.push(Date.now() - start);
      return answer(times.length);
    }),
  );
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useOrderStatus(ORDER_ID), { wrapper });
  return { times, result };
}
const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const offline = () => Promise.reject(new TypeError("Failed to fetch"));

test("polls every 3 seconds while the payer looks and every 15 in the background", async () => {
  const shown = mount(() => reply("pending", 30 * MINUTE));
  await wait(9_500);
  expect(shown.times).toEqual([0, 3_000, 6_000, 9_000]);
  expect(shown.result.current.kind).toBe("pending");
});

test("polls every 15 seconds while the page is hidden", async () => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  const hidden = mount(() => reply("pending", 30 * MINUTE));
  await wait(31_000);
  expect(hidden.times).toEqual([0, 15_000, 30_000]);
});

test("backs off after consecutive failed refreshes and keeps the order on screen", async () => {
  const { times, result } = mount((call) =>
    call === 1 ? reply("pending", 30 * MINUTE) : offline(),
  );
  await wait(76_000);
  expect(times).toEqual([0, 3_000, 9_000, 21_000, 45_000, 75_000]);
  expect(result.current).toMatchObject({ kind: "pending", reconnecting: true });
});

test("stops polling once paid", async () => {
  const { times, result } = mount((call) =>
    call === 1 ? reply("pending", 30 * MINUTE) : reply("paid", 30 * MINUTE),
  );
  await wait(60_000);
  expect(times).toEqual([0, 3_000]);
  expect(result.current.kind).toBe("paid");
});

test("stops polling for an order the backend does not know", async () => {
  const { times, result } = mount(() =>
    json({ code: "ORDER_NOT_FOUND", message: "Not found" }, 404),
  );
  await wait(60_000);
  expect(times).toEqual([0]);
  expect(result.current.kind).toBe("notFound");
});

test("keeps polling an expired order every 15 seconds until ten minutes past expiry", async () => {
  const { times, result } = mount(() => reply("expired", -(9 * MINUTE + 20_000)));
  await wait(2 * MINUTE);
  expect(times).toEqual([0, 15_000, 30_000, 45_000]);
  expect(result.current).toMatchObject({ kind: "expired", reconnecting: false });
});

test("counts down on the server's clock", async () => {
  const { result } = mount(() => reply("pending", 5 * MINUTE, MINUTE));
  await wait(0);
  // The server runs a minute ahead: its expiry timestamp reads six minutes away on this device,
  // but it is five minutes after the server's own time, so five minutes remain here.
  expect(result.current).toMatchObject({ kind: "pending", deadline: start + 5 * MINUTE });
});

test("asks again the moment the invoice expires instead of waiting for the next poll", async () => {
  const { times, result } = mount((call) =>
    call < 3 ? reply("pending", 4_500) : reply("expired", 4_500),
  );
  await wait(5_000);
  expect(times).toEqual([0, 3_000, 4_500]);
  expect(result.current.kind).toBe("expired");
});
