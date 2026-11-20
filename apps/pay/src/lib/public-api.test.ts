import { expect, test, vi } from "vite-plus/test";
import { ORDER_ID, json, merchant } from "../test/fixtures";
import { publicApi, PublicApiError } from "./public-api";
import { merchantFn, orderFn } from "./public-api.functions";

const failureOf = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected the call to fail");
    },
    (cause: unknown) => cause as PublicApiError,
  );

test("a call returns what the server function settled with", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(merchant())),
  );
  expect(await publicApi.merchant({ params: { slug: "onne" } })).toEqual(merchant());
  expect(merchantFn).toHaveBeenCalledWith(
    expect.objectContaining({ data: { params: { slug: "onne" } } }),
  );
});

test("a settled failure becomes the same PublicApiError the backend described", async () => {
  vi.mocked(merchantFn).mockResolvedValueOnce({
    ok: false,
    code: "RATE_LIMITED",
    retryable: true,
    outcomeUnknown: false,
  });
  const error = await failureOf(publicApi.merchant({ params: { slug: "onne" } }));
  expect(error).toBeInstanceOf(PublicApiError);
  expect(error).toMatchObject({ code: "RATE_LIMITED", retryable: true, outcomeUnknown: false });
});

test("an unreachable server function is a retryable network failure of unknown outcome", async () => {
  vi.mocked(merchantFn).mockRejectedValueOnce(new TypeError("Failed to fetch"));
  expect(await failureOf(publicApi.merchant({ params: { slug: "onne" } }))).toMatchObject({
    code: "NETWORK",
    retryable: true,
    outcomeUnknown: true,
  });

  vi.mocked(merchantFn).mockResolvedValueOnce(undefined as never);
  expect(await failureOf(publicApi.merchant({ params: { slug: "onne" } }))).toMatchObject({
    code: "UNEXPECTED_RESPONSE",
    outcomeUnknown: true,
  });
});

test("a call with no answer times out after 20 seconds; the caller's cancel passes through", async () => {
  const hang = ({ signal }: { signal?: AbortSignal }) =>
    new Promise<never>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason));
    });
  vi.mocked(orderFn).mockImplementationOnce(hang as never);
  vi.useFakeTimers();
  const timedOut = failureOf(publicApi.order({ params: { orderId: ORDER_ID } }));
  await vi.advanceTimersByTimeAsync(20_000);
  expect(await timedOut).toMatchObject({ code: "TIMEOUT", retryable: true });

  vi.mocked(orderFn).mockImplementationOnce(hang as never);
  const controller = new AbortController();
  const cancelled = failureOf(
    publicApi.order({ params: { orderId: ORDER_ID } }, { signal: controller.signal }),
  );
  controller.abort(new DOMException("left", "AbortError"));
  expect(await cancelled).not.toBeInstanceOf(PublicApiError);
});
