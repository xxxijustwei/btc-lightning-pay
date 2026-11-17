// @vitest-environment node
import { expect, test, vi } from "vite-plus/test";
import { proxyBackendRequest } from "./backend-proxy";

test("auth proxy preserves POST data, origin, client IP and cookies through the service binding", async () => {
  const request = new Request("https://app.example/api/auth/sign-in/email-otp?test=1", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example",
      "cf-connecting-ip": "203.0.113.1",
      cookie: "old=session",
      host: "app.example",
      connection: "keep-alive",
    },
    body: JSON.stringify({ email: "user@example.com", otp: "123456" }),
  });
  const backend = {
    fetch: vi.fn(async (forwarded: Request) => {
      expect(forwarded.url).toBe("https://backend/api/auth/sign-in/email-otp?test=1");
      expect(forwarded.method).toBe("POST");
      expect(forwarded.redirect).toBe("manual");
      expect(await forwarded.json()).toEqual({ email: "user@example.com", otp: "123456" });
      expect(forwarded.headers.get("origin")).toBe("https://app.example");
      expect(forwarded.headers.get("cookie")).toBe("old=session");
      expect(forwarded.headers.get("cf-connecting-ip")).toBe("203.0.113.1");
      expect(forwarded.headers.get("host")).toBeNull();
      const headers = new Headers({ "content-encoding": "gzip", "content-length": "999" });
      headers.append("set-cookie", "session=new; HttpOnly; Secure");
      headers.append("set-cookie", "old=; Max-Age=0");
      return Response.json({ ok: true }, { headers });
    }),
  };
  const response = await proxyBackendRequest(request, backend);
  expect(response.headers.getSetCookie()).toEqual([
    "session=new; HttpOnly; Secure",
    "old=; Max-Age=0",
  ]);
  expect(response.headers.get("content-length")).toBeNull();
  expect(response.headers.get("content-encoding")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ ok: true });
});
test("proxy keeps backend failures and converts transport errors to a safe no-store 502", async () => {
  const request = () => new Request("https://app.example/api/me");
  expect(
    (
      await proxyBackendRequest(request(), {
        fetch: async () => Response.json({ code: "UNAUTHORIZED" }, { status: 401 }),
      })
    ).status,
  ).toBe(401);
  const response = await proxyBackendRequest(request(), {
    fetch: async () => {
      throw new Error("private infrastructure detail");
    },
  });
  expect(response.status).toBe(502);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).not.toContain("private infrastructure");
});
