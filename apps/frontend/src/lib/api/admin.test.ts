import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { AdminApiError, adminApi, describeAdminError } from "./admin";

const SETTLEMENT = {
  id: "c41e0b7d-2f6a-4c19-8e3d-5a07b91fa2f9",
  merchantId: "3b1f6c2e-8a4d-4e7b-9c05-2d6e81fa7c19",
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
};

function stub(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => respond(url, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** A request that never answers; it fails only when its signal aborts. */
function stubHanging() {
  return stub(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );
}

const failureOf = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected the call to fail");
    },
    (cause: unknown) => cause as AdminApiError,
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("adminApi requests", () => {
  it("settles with only merchantId and the idempotency key, sending the session cookie", async () => {
    const fetchMock = stub(() => Response.json(SETTLEMENT, { status: 201 }));
    const result = await adminApi.settle({
      headers: { "idempotency-key": "key-1234567890abcdef" },
      payload: { merchantId: SETTLEMENT.merchantId },
    });
    expect(result.amountSat).toBe(361690);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/settlements");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(String(init.body))).toEqual({ merchantId: SETTLEMENT.merchantId });
    expect(new Headers(init.headers).get("idempotency-key")).toBe("key-1234567890abcdef");
  });

  it("sends numbers in list queries as text and drops empty filters", async () => {
    const fetchMock = stub(() => Response.json([]));
    await adminApi.orders({
      query: { limit: 11, offset: 10, merchantId: undefined, status: "paid", from: "" },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/admin/orders?limit=11&offset=10&status=paid");
  });

  it("encodes path parameters and refuses ones that would change the route", async () => {
    const fetchMock = stub(() =>
      Response.json({
        id: "a/b c",
        name: "A",
        email: "a@example.com",
        role: "admin",
        banned: true,
        merchantId: null,
        createdAt: "2026-11-17T10:05:12.348Z",
      }),
    );
    await adminApi.updateUser({ params: { userId: "a/b c" }, payload: { banned: true } });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/admin/users/a%2Fb%20c");

    const dots = await failureOf(
      adminApi.updateUser({ params: { userId: ".." }, payload: { banned: true } }),
    );
    expect(dots.code).toBe("INVALID_INPUT");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects input the contract forbids before sending it", async () => {
    const fetchMock = stub(() => Response.json(SETTLEMENT));
    const error = await failureOf(
      adminApi.settle({
        headers: { "idempotency-key": "short" },
        payload: { merchantId: SETTLEMENT.merchantId },
      }),
    );
    expect(error).toMatchObject({ code: "INVALID_INPUT", retryable: false, outcomeUnknown: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("adminApi failures", () => {
  it("turns backend problems into contract codes with safe messages", async () => {
    stub(() => Response.json({ code: "LAST_ADMIN", message: "internal detail" }, { status: 409 }));
    const error = await failureOf(
      adminApi.updateUser({ params: { userId: "u1" }, payload: { banned: true } }),
    );
    expect(error).toBeInstanceOf(AdminApiError);
    expect(error).toMatchObject({ code: "LAST_ADMIN", retryable: false, outcomeUnknown: false });
    expect(describeAdminError(error)).toBe(
      "不能禁用最后一位启用的管理员。请先新建或恢复另一位管理员。",
    );
    expect(describeAdminError(error)).not.toContain("internal detail");
  });

  it("reports a request that got no response as retryable with an unknown outcome", async () => {
    stub(() => Promise.reject(new TypeError("Failed to fetch")));
    const error = await failureOf(adminApi.users({ query: { limit: 11, offset: 0 } }));
    expect(error).toMatchObject({ code: "NETWORK", retryable: true, outcomeUnknown: true });
    expect(describeAdminError(error)).toContain("无法连接服务");
  });

  it("reads the proxy's unreachable-backend answer as a contract code", async () => {
    stub(() => Response.json({ code: "BACKEND_UNAVAILABLE", message: "后端" }, { status: 502 }));
    const error = await failureOf(adminApi.users({ query: { limit: 11, offset: 0 } }));
    expect(error).toMatchObject({
      code: "BACKEND_UNAVAILABLE",
      retryable: true,
      outcomeUnknown: true,
    });
  });

  it("classifies answers outside the contract by their status", async () => {
    stub(() => new Response("", { status: 404 }));
    const missing = await failureOf(adminApi.order({ params: { orderId: SETTLEMENT.id } }));
    expect(missing).toMatchObject({
      code: "UNEXPECTED_RESPONSE",
      retryable: false,
      outcomeUnknown: false,
    });

    stub(() => new Response("<html>oops</html>", { status: 502 }));
    const down = await failureOf(adminApi.users({ query: { limit: 11, offset: 0 } }));
    expect(down).toMatchObject({
      code: "UNEXPECTED_RESPONSE",
      retryable: true,
      outcomeUnknown: true,
    });
  });

  it("treats a success it cannot read as an unknown outcome", async () => {
    stub(() => Response.json({ ...SETTLEMENT, amountSat: "lots" }, { status: 201 }));
    const error = await failureOf(
      adminApi.settle({
        headers: { "idempotency-key": "key-1234567890abcdef" },
        payload: { merchantId: SETTLEMENT.merchantId },
      }),
    );
    expect(error).toMatchObject({ code: "UNEXPECTED_RESPONSE", outcomeUnknown: true });
  });

  it("gives up after 15 seconds without an answer", async () => {
    vi.useFakeTimers();
    stubHanging();
    const pending = failureOf(adminApi.users({ query: { limit: 11, offset: 0 } }));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toMatchObject({
      code: "TIMEOUT",
      retryable: true,
      outcomeUnknown: true,
    });
  });

  it("passes the caller's own cancellation through untouched", async () => {
    stubHanging();
    const controller = new AbortController();
    const pending = failureOf(
      adminApi.users({ query: { limit: 11, offset: 0 } }, { signal: controller.signal }),
    );
    controller.abort(new DOMException("left the page", "AbortError"));
    const cause = await pending;
    expect(cause).not.toBeInstanceOf(AdminApiError);
    expect((cause as unknown as DOMException).name).toBe("AbortError");
  });
});
