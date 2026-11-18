// @vitest-environment node
import { describe, expect, it, vi } from "vite-plus/test";
import { proxyPublicRequest } from "./backend-proxy";

describe("proxyPublicRequest", () => {
  it("forwards public API calls without cookies or credentials", async () => {
    const backend = {
      fetch: vi.fn(async (request: Request) => {
        expect(new URL(request.url).pathname).toBe("/api/public/orders/abc");
        expect(new URL(request.url).search).toBe("?x=1");
        expect(request.headers.get("cookie")).toBeNull();
        expect(request.headers.get("authorization")).toBeNull();
        return new Response('{"ok":true}', {
          headers: { "content-type": "application/json", "set-cookie": "a=b" },
        });
      }),
    };
    const response = await proxyPublicRequest(
      new Request("https://pay.example/api/public/orders/abc?x=1", {
        headers: { cookie: "session=secret", authorization: "Bearer secret" },
      }),
      backend,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(backend.fetch).toHaveBeenCalledOnce();
  });

  it("never reaches non-public backend routes", async () => {
    const backend = { fetch: vi.fn() };
    const response = await proxyPublicRequest(
      new Request("https://pay.example/api/admin/merchants"),
      backend,
    );
    expect(response.status).toBe(404);
    expect(backend.fetch).not.toHaveBeenCalled();
  });

  it("reports an unavailable backend as a 502 problem", async () => {
    const backend = { fetch: vi.fn(async () => Promise.reject(new Error("down"))) };
    const response = await proxyPublicRequest(
      new Request("https://pay.example/api/public/merchants/onne"),
      backend,
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "BACKEND_UNAVAILABLE" });
  });
});
