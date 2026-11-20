// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ORDER_ID, json, merchant, order } from "../test/fixtures";
import { backendCalls, settle } from "./public-calls";

const payerRequest = () =>
  new Request("https://pay.example/_serverFn/abc", {
    headers: {
      cookie: "session=secret",
      authorization: "Bearer secret",
      "cf-connecting-ip": "203.0.113.7",
    },
  });
const backendAnswering = (answer: (request: Request) => Response | Promise<Response>) => ({
  fetch: vi.fn(async (request: Request) => answer(request)),
});

afterEach(() => vi.useRealTimers());

describe("backendCalls", () => {
  it("sends the contract's path, key header and payload with only the payer's IP", async () => {
    const backend = backendAnswering(() => json(order("pending")));
    const outcome = await settle(() =>
      backendCalls(payerRequest(), backend).createOrder({
        params: { slug: "onne" },
        headers: { "idempotency-key": "key-0000000000000001" },
        payload: { amountUsdCents: 2500 },
      }),
    );
    expect(outcome).toMatchObject({ ok: true, value: { id: ORDER_ID, status: "pending" } });
    const request = backend.fetch.mock.calls[0]![0];
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/api/public/merchants/onne/orders");
    expect(await request.json()).toEqual({ amountUsdCents: 2500 });
    expect(request.headers.get("idempotency-key")).toBe("key-0000000000000001");
    expect(request.headers.get("cf-connecting-ip")).toBe("203.0.113.7");
    expect(request.headers.get("cookie")).toBeNull();
    expect(request.headers.get("authorization")).toBeNull();
  });

  it("refuses input the contract forbids before reaching the backend", async () => {
    const backend = backendAnswering(() => json(merchant()));
    const calls = backendCalls(payerRequest(), backend);
    expect(await settle(() => calls.merchant({ params: { slug: "../admin" } }))).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      retryable: false,
      outcomeUnknown: false,
    });
    expect(
      await settle(() => calls.order({ params: { orderId: "../admin/merchants" } })),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(backend.fetch).not.toHaveBeenCalled();
  });

  it("reports failures as data with the contract or caller code", async () => {
    const answerWith = async (answer: () => Response | Promise<Response>) =>
      settle(() =>
        backendCalls(payerRequest(), backendAnswering(answer)).merchant({
          params: { slug: "onne" },
        }),
      );

    expect(
      await answerWith(() => json({ code: "MERCHANT_NOT_FOUND", message: "Not found" }, 404)),
    ).toEqual({ ok: false, code: "MERCHANT_NOT_FOUND", retryable: false, outcomeUnknown: false });
    expect(await answerWith(() => new Response("", { status: 404 }))).toMatchObject({
      code: "UNEXPECTED_RESPONSE",
      retryable: false,
    });
    expect(await answerWith(() => json({ ...merchant(), merchantId: 7 }))).toMatchObject({
      code: "UNEXPECTED_RESPONSE",
      outcomeUnknown: true,
    });
    expect(await answerWith(() => Promise.reject(new Error("binding down")))).toEqual({
      ok: false,
      code: "BACKEND_UNAVAILABLE",
      retryable: true,
      outcomeUnknown: true,
    });
  });

  it("gives up on a backend that has not answered after 15 seconds", async () => {
    vi.useFakeTimers();
    const backend = {
      fetch: vi.fn(
        (request: Request) =>
          new Promise<Response>((_resolve, reject) =>
            request.signal.addEventListener("abort", () => reject(request.signal.reason)),
          ),
      ),
    };
    const outcome = settle(() =>
      backendCalls(payerRequest(), backend).order({ params: { orderId: ORDER_ID } }),
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await outcome).toMatchObject({ ok: false, code: "TIMEOUT", retryable: true });
  });
});
