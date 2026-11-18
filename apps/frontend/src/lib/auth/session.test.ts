// @vitest-environment node
import { expect, test, vi } from "vite-plus/test";
import { readCurrentUser } from "./session";

const user = { role: "admin", id: "u1", email: "user@example.com", name: "User", image: null };
test("a cookie-free request is anonymous without contacting the backend", async () => {
  const fetchBackend = vi.fn();
  expect(
    await readCurrentUser(new Request("https://app.example/"), fetchBackend, vi.fn()),
  ).toBeNull();
  expect(
    await readCurrentUser(
      new Request("https://app.example/", { headers: { cookie: "theme=dark" } }),
      fetchBackend,
      vi.fn(),
    ),
  ).toBeNull();
  expect(fetchBackend).not.toHaveBeenCalled();
});
test("SSR forwards only the request cookie, projects the user and appends all refreshed cookies", async () => {
  const headers = new Headers();
  headers.append("set-cookie", "session=fresh; HttpOnly");
  headers.append("set-cookie", "old=; Max-Age=0");
  const fetchBackend = vi.fn(async (request: Request) => {
    expect(request.url).toBe("https://backend/api/me");
    expect(request.headers.get("cookie")).toBe("btc-lightning-pay.session_token=user-one");
    expect(request.headers.get("authorization")).toBeNull();
    return Response.json({ ...user, secret: "must-not-reach-client" }, { headers });
  });
  const append = vi.fn();
  expect(
    await readCurrentUser(
      new Request("https://app.example/", {
        headers: { cookie: "btc-lightning-pay.session_token=user-one", authorization: "private" },
      }),
      fetchBackend,
      append,
    ),
  ).toEqual(user);
  expect(append.mock.calls).toEqual([["session=fresh; HttpOnly"], ["old=; Max-Age=0"]]);
});
test("only 401 means signed out; service failures and malformed payloads remain errors", async () => {
  const request = new Request("https://app.example/", {
    headers: { cookie: "btc-lightning-pay.session_token=old" },
  });
  const append = vi.fn();
  expect(
    await readCurrentUser(
      request,
      async () =>
        Response.json({}, { status: 401, headers: { "set-cookie": "session=; Max-Age=0" } }),
      append,
    ),
  ).toBeNull();
  expect(append).toHaveBeenCalledWith("session=; Max-Age=0");
  await expect(
    readCurrentUser(request, async () => Response.json({}, { status: 503 }), vi.fn()),
  ).rejects.toThrow();
  await expect(
    readCurrentUser(request, async () => Response.json({ id: 1 }), vi.fn()),
  ).rejects.toThrow();
  await expect(
    readCurrentUser(
      request,
      async () => {
        throw new Error("unavailable");
      },
      vi.fn(),
    ),
  ).rejects.toThrow();
});
test("concurrent SSR requests retain their own identity", async () => {
  const fetchBackend = async (request: Request) =>
    Response.json({ ...user, id: request.headers.get("cookie")?.split("=")[1] });
  const results = await Promise.all(
    ["one", "two"].map((cookie) =>
      readCurrentUser(
        new Request("https://app.example/", {
          headers: { cookie: `btc-lightning-pay.session_token=${cookie}` },
        }),
        fetchBackend,
        vi.fn(),
      ),
    ),
  );
  expect(results.map((result) => result?.id)).toEqual(["one", "two"]);
});

test("secure cookie presence still requires successful backend verification", async () => {
  const fetchBackend = vi.fn(async () => Response.json({}, { status: 401 }));
  expect(
    await readCurrentUser(
      new Request("https://app.example/", {
        headers: { cookie: "__Secure-btc-lightning-pay.session_token=untrusted" },
      }),
      fetchBackend,
      vi.fn(),
    ),
  ).toBeNull();
  expect(fetchBackend).toHaveBeenCalledTimes(1);
});

test("another localhost app's default auth cookie does not block this login page", async () => {
  const fetchBackend = vi.fn(async () =>
    Response.json({ code: "AUTH_NOT_CONFIGURED" }, { status: 503 }),
  );
  const request = new Request("http://localhost:3000/sign-in", {
    headers: { cookie: "better-auth.session_token=another-app" },
  });
  expect(await readCurrentUser(request, fetchBackend, vi.fn())).toBeNull();
  expect(fetchBackend).not.toHaveBeenCalled();
});
