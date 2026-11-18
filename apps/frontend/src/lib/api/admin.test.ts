import { describe, expect, it, vi } from "vite-plus/test";
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

describe("adminApi", () => {
  it("creates a settlement with only merchantId and the idempotency key", async () => {
    const fetchMock = vi.fn(async () => Response.json(SETTLEMENT, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await adminApi.createSettlement(SETTLEMENT.merchantId, "key-1234567890abcdef");
    expect(result.amountSat).toBe(361690);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/settlements");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ merchantId: SETTLEMENT.merchantId });
    expect(new Headers(init.headers).get("idempotency-key")).toBe("key-1234567890abcdef");
  });

  it("drops empty filters from list queries", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json([]));
    vi.stubGlobal("fetch", fetchMock);
    await adminApi.orders({ limit: 11, offset: 10, merchantId: undefined, status: "paid" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/admin/orders?limit=11&offset=10&status=paid");
  });

  it("turns backend problems into typed errors with safe messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ code: "LAST_ADMIN", message: "internal detail" }, { status: 409 }),
      ),
    );
    const error = await adminApi
      .updateUser("u1", { banned: true })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(AdminApiError);
    expect((error as AdminApiError).code).toBe("LAST_ADMIN");
    expect(describeAdminError(error)).toBe("不能禁用最后一位启用的管理员。");
    expect(describeAdminError(error)).not.toContain("internal detail");
  });

  it("reports network failures and unknown server faults without backend details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const offline = await adminApi.users({ limit: 11, offset: 0 }).catch((cause: unknown) => cause);
    expect((offline as AdminApiError).status).toBe(0);
    expect(describeAdminError(offline)).toContain("无法连接服务");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>oops</html>", { status: 502 })),
    );
    const down = await adminApi.users({ limit: 11, offset: 0 }).catch((cause: unknown) => cause);
    expect(describeAdminError(down)).toBe("服务暂时不可用，请稍后重试。");
  });
});
