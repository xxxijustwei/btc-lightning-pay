import { Context } from "effect";
import { afterAll, afterEach, expect, test, vi } from "vite-plus/test";
import { dispose, handler } from "./app";
import { createPhoenix, Phoenix } from "./phoenix";

afterAll(dispose);
afterEach(() => vi.unstubAllGlobals());
const valid = { amountSat: 1000, paymentHash: "a".repeat(64), serialized: "lnbc10u1testinvoice" };
const context = (env = { APP_ENV: "development", PHOENIX_HTTP_PASSWORD: "limited-secret" }) =>
  Context.make(Phoenix, createPhoenix(env));
const request = (body: unknown = { amountSat: 1000, description: "Demo & test" }) =>
  new Request("http://localhost/api/invoices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("unauthenticated create endpoint sends encoded form with server-only credentials", async () => {
  const upstream = vi.fn(async (url: string, options: RequestInit) => {
    expect(url).toBe("http://127.0.0.1:9740/createinvoice");
    expect(options.method).toBe("POST");
    expect(options.redirect).toBe("manual");
    expect(new Headers(options.headers).get("authorization")).toBe(
      `Basic ${btoa(":limited-secret")}`,
    );
    expect(new URLSearchParams(String(options.body)).get("description")).toBe("Demo & test");
    expect(new URLSearchParams(String(options.body)).get("expirySeconds")).toBe("3600");
    return Response.json(valid);
  });
  vi.stubGlobal("fetch", upstream);
  const response = await handler(request(), context());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(valid);
  expect(upstream).toHaveBeenCalledTimes(1);
});

test.each([0, -1, 0.5, 1_000_001, "1000", null])(
  "invalid amount %s never reaches phoenixd",
  async (amountSat) => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await handler(request({ amountSat, description: "Demo" }), context());
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(upstream).not.toHaveBeenCalled();
  },
);

test.each(["", "x".repeat(129)])("invalid description is rejected", async (description) => {
  const upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);
  expect(
    (await handler(request({ amountSat: 1000, description }), context())).status,
  ).toBeGreaterThanOrEqual(400);
  expect(upstream).not.toHaveBeenCalled();
});

test.each([
  () => new Response(null, { status: 302, headers: { location: "https://unexpected.example" } }),
  () => Response.json({ error: "secret upstream detail" }, { status: 401 }),
  () => Response.json({ ...valid, amountSat: 999 }),
  () => Response.json({ ...valid, serialized: "lntb1wrongnetwork" }),
  () => {
    throw new Error("secret network detail");
  },
  () => {
    throw new DOMException("timed out", "TimeoutError");
  },
])("upstream failure returns a safe 503 without automatic retry", async (reply) => {
  const upstream = vi.fn(reply);
  vi.stubGlobal("fetch", upstream);
  const response = await handler(request(), context());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("secret");
  expect(upstream).toHaveBeenCalledTimes(1);
});

test.each([
  { APP_ENV: "production", PHOENIX_HTTP_PASSWORD: "limited-secret" },
  { APP_ENV: "development", PHOENIX_HTTP_PASSWORD: "" },
])("demo is unavailable outside configured local development", async (env) => {
  const upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);
  expect((await handler(request(), context(env))).status).toBe(503);
  expect(upstream).not.toHaveBeenCalled();
});
