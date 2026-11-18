import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import * as schema from "@btc-lightning-pay/db/schema";
import { beforeAll, afterAll, beforeEach, afterEach, test, expect, vi } from "vite-plus/test";
import { createAuth } from "./auth";
import { handleAuth } from "./handler";
import worker from "../index";
import { dispose } from "../app";

const pg = new PGlite();
const database = drizzle(pg, { schema });
const close = vi.fn(async () => {});
const connect = vi.fn(() => ({ database, close }));
const send = vi.fn(async (_message: { email: string; otp: string }) => {});
vi.mock("@btc-lightning-pay/db/client", () => ({
  createDatabase: () => connect(),
}));
vi.mock("./email", () => ({ OTP_EXPIRATION_SECONDS: 300, createOTPSender: () => send }));
const config = {
  url: "http://localhost:3000",
  secret: "test-only-42ef97c3a18b46d8a0921dc78359ba77",
};
const bindings = {
  BETTER_AUTH_URL: config.url,
  BETTER_AUTH_SECRET: config.secret,
  DATABASE_URL: "postgres://test:test@localhost/test",
  RESEND_API_KEY: "test-key",
  AUTH_EMAIL_FROM: "test@example.com",
};
const provision = readFileSync(
  new NodeURL("../../../../packages/db/sql/provision-user.sql", import.meta.url),
  "utf8",
);
const makeAuth = () => createAuth(config, database, send);
function request(path: string, body?: unknown, cookie?: string, ip = "203.0.113.1") {
  return new Request(`${config.url}/api/auth${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      origin: config.url,
      "cf-connecting-ip": ip,
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const sendRequest = (email = "user@example.com") =>
  request("/email-otp/send-verification-otp", { email, type: "sign-in" });
function cookieOf(response: Response) {
  return response.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
}
beforeAll(async () => {
  await pg.exec(
    readFileSync(new NodeURL("../../../../packages/db/sql/schema.sql", import.meta.url), "utf8"),
  );
});
afterAll(async () => {
  await pg.close();
  await dispose();
});
afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  await database.execute(
    sql`TRUNCATE public."user", public.session, public.account, public.verification CASCADE`,
  );
  send.mockReset();
  close.mockClear();
});

test("schema and supplied SQL provision idempotently without pre-verifying email", async () => {
  await pg.exec(provision);
  await pg.exec(provision);
  const users = await database.select().from(schema.user);
  expect(users).toHaveLength(1);
  expect(users[0].emailVerified).toBe(false);
  await expect(
    database.insert(schema.user).values({ id: "bad", email: "User@Example.com", name: "Bad" }),
  ).rejects.toThrow();
});
test("unknown emails receive no mail and cannot register", async () => {
  const auth = makeAuth();
  expect((await auth.handler(sendRequest())).status).toBe(200);
  expect(send).not.toHaveBeenCalled();
  expect(
    (
      await auth.handler(
        request("/sign-in/email-otp", { email: "user@example.com", otp: "123456" }),
      )
    ).status,
  ).toBe(400);
  expect(await database.select().from(schema.user)).toHaveLength(0);
});
test("pre-opened user can login, read a protected API, then logout with no reusable session", async () => {
  await pg.exec(provision);
  const auth = makeAuth();
  expect((await auth.handler(sendRequest())).status).toBe(200);
  const otp = send.mock.calls[0][0].otp;
  const stored = await database.select().from(schema.verification);
  expect(stored[0].value).not.toContain(otp);
  const login = await auth.handler(
    request("/sign-in/email-otp", { email: "user@example.com", otp }),
  );
  expect(login.status).toBe(200);
  const cookie = cookieOf(login);
  expect(cookie).toContain("btc-lightning-pay.session_token=");
  expect(cookie).not.toContain("better-auth.session_token=");
  expect(login.headers.get("set-cookie")).toContain("HttpOnly");
  const meRequest = new Request(`${config.url}/api/me`, { headers: { cookie } });
  const me = await worker.fetch(meRequest, bindings);
  expect(me.status).toBe(200);
  expect(await me.json()).toEqual({
    id: expect.any(String),
    name: "Example User",
    role: "admin",
    email: "user@example.com",
    image: null,
  });
  expect(me.headers.get("cache-control")).toBe("no-store");
  expect(close).toHaveBeenCalled();
  const adminRequest = new Request(`${config.url}/api/admin/merchants`, { headers: { cookie } });
  expect((await worker.fetch(adminRequest, bindings)).status).toBe(200);
  expect(
    (
      await worker.fetch(
        new Request(`${config.url}/api/admin/merchants`, {
          method: "POST",
          headers: {
            cookie,
            origin: "https://untrusted.example",
            "content-type": "application/json",
          },
          body: JSON.stringify({ id: "forged" }),
        }),
        bindings,
      )
    ).status,
  ).toBe(403);
  await pg.exec(provision);
  expect((await database.select().from(schema.user))[0].emailVerified).toBe(true);
  const replay = await auth.handler(
    request("/sign-in/email-otp", { email: "user@example.com", otp }),
  );
  expect(replay.status).toBe(400);
  expect((await auth.handler(request("/sign-out", {}, cookie))).status).toBe(200);
  expect((await handleAuth(meRequest, bindings)).status).toBe(401);
});
test("sending and signing in are not rate limited across auth instances", async () => {
  await pg.exec(provision);
  for (let attempt = 0; attempt < 6; attempt++) {
    expect((await makeAuth().handler(sendRequest())).status).toBe(200);
    const otp = send.mock.calls[attempt][0].otp;
    expect(
      (await makeAuth().handler(request("/sign-in/email-otp", { email: "user@example.com", otp })))
        .status,
    ).toBe(200);
  }
  expect(send).toHaveBeenCalledTimes(6);
});
test("expired codes fail", async () => {
  await pg.exec(provision);
  const auth = makeAuth();
  await auth.handler(sendRequest());
  const otp = send.mock.calls[0][0].otp;
  await database.update(schema.verification).set({ expiresAt: new Date(0) });
  expect(
    (await auth.handler(request("/sign-in/email-otp", { email: "user@example.com", otp }))).status,
  ).toBe(400);
});
test("failed delivery is not reported as success", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await pg.exec(provision);
  send.mockRejectedValueOnce(new Error("provider failure"));
  expect((await handleAuth(sendRequest(), bindings)).status).toBe(503);
  expect(log).toHaveBeenCalledWith(
    JSON.stringify({
      event: "auth_request_failed",
      path: "/api/auth/email-otp/send-verification-otp",
    }),
  );
  expect(close).toHaveBeenCalled();
});
test("unsupported flows and missing configuration fail closed", async () => {
  expect((await handleAuth(request("/sign-up/email", {}), bindings)).status).toBe(404);
  expect((await handleAuth(sendRequest(), {})).status).toBe(503);
  expect((await handleAuth(request("/get-session"), bindings)).headers.get("cache-control")).toBe(
    "no-store",
  );
  expect(
    (
      await makeAuth().handler(
        request("/email-otp/send-verification-otp", {
          email: "user@example.com",
          type: "forget-password",
        }),
      )
    ).status,
  ).toBe(400);
});

test("RLS blocks public API roles even if Supabase grants table access", async () => {
  await pg.exec(provision);
  await makeAuth().handler(sendRequest());
  const [user] = await database.select().from(schema.user);
  await database.insert(schema.session).values({
    id: "rls-session",
    token: "private-token",
    userId: user.id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  await database
    .insert(schema.account)
    .values({ id: "rls-account", accountId: user.id, providerId: "test", userId: user.id });
  await pg.exec(`CREATE ROLE auth_data_api NOSUPERUSER NOBYPASSRLS;
    GRANT USAGE ON SCHEMA public TO auth_data_api;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO auth_data_api;
    SET ROLE auth_data_api;`);
  try {
    for (const table of ["user", "account", "session", "verification"]) {
      const result = await pg.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM public."${table}"`,
      );
      expect(result.rows[0].count).toBe(0);
    }
    await expect(pg.exec(provision)).rejects.toThrow(/row-level security/);
  } finally {
    await pg.exec("RESET ROLE");
  }
});

test("a code is invalidated after three wrong attempts", async () => {
  await pg.exec(provision);
  const auth = makeAuth();
  await auth.handler(sendRequest());
  const otp = send.mock.calls[0][0].otp;
  const wrong = otp === "000000" ? "111111" : "000000";
  for (let attempt = 0; attempt < 3; attempt++) {
    expect(
      (await auth.handler(request("/sign-in/email-otp", { email: "user@example.com", otp: wrong })))
        .status,
    ).toBe(400);
  }
  expect(
    (await auth.handler(request("/sign-in/email-otp", { email: "user@example.com", otp }))).status,
  ).toBe(403);
  expect(await database.select().from(schema.session)).toHaveLength(0);
});

test("untrusted browser origins cannot send codes", async () => {
  await pg.exec(provision);
  const req = sendRequest();
  req.headers.set("origin", "https://untrusted.example");
  expect((await makeAuth().handler(req)).status).toBe(403);
  expect(send).not.toHaveBeenCalled();
});

test("request cookies isolate users and deletion revokes sessions", async () => {
  await pg.exec(provision);
  await pg.exec(provision.replaceAll("user@example.com", "other@example.com"));
  const cookies: string[] = [];
  for (const [index, email] of ["user@example.com", "other@example.com"].entries()) {
    const ip = `203.0.113.${index + 10}`;
    const auth = makeAuth();
    await auth.handler(
      request("/email-otp/send-verification-otp", { email, type: "sign-in" }, undefined, ip),
    );
    const otp = send.mock.calls[index][0].otp;
    const response = await auth.handler(
      request("/sign-in/email-otp", { email, otp }, undefined, ip),
    );
    expect(response.status).toBe(200);
    cookies.push(cookieOf(response));
  }
  const results = await Promise.all(
    cookies.map((cookie) =>
      handleAuth(new Request(`${config.url}/api/me`, { headers: { cookie } }), bindings),
    ),
  );
  expect(await results[0].json()).toMatchObject({ email: "user@example.com" });
  expect(await results[1].json()).toMatchObject({ email: "other@example.com" });
  await pg.exec(`DELETE FROM public."user" WHERE email = 'user@example.com'`);
  expect(
    (
      await handleAuth(
        new Request(`${config.url}/api/me`, { headers: { cookie: cookies[0] } }),
        bindings,
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await handleAuth(
        new Request(`${config.url}/api/me`, { headers: { cookie: cookies[1] } }),
        bindings,
      )
    ).status,
  ).toBe(200);
});

test("the Worker keeps health independent and reports configuration failures explicitly", async () => {
  expect((await worker.fetch(new Request(`${config.url}/api/health`), {})).status).toBe(200);
  const response = await worker.fetch(new Request(`${config.url}/api/me`), {});
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "AUTH_NOT_CONFIGURED" });
  expect((await worker.fetch(request("/sign-in/email-otp"), bindings)).status).toBe(405);
});

test("database failures do not become anonymous sessions or leak credentials", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  connect.mockImplementationOnce(() => {
    throw new Error("postgres://secret:password@host/db");
  });
  const response = await worker.fetch(new Request(`${config.url}/api/me`), bindings);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    code: "AUTH_UNAVAILABLE",
    message: "登录服务暂时不可用，请稍后重试。",
  });
  expect(log).toHaveBeenCalledWith(
    JSON.stringify({ event: "auth_request_failed", path: "/api/me" }),
  );
});

test("HTTPS cookies are secure and expired sessions are rejected", async () => {
  await pg.exec(provision);
  const url = "https://pay.example.com";
  const auth = createAuth({ ...config, url }, database, send);
  const httpsRequest = (path: string, body: unknown) => {
    const req = request(path, body);
    req.headers.set("origin", url);
    return new Request(req.url.replace(config.url, url), req);
  };
  await auth.handler(
    httpsRequest("/email-otp/send-verification-otp", {
      email: "user@example.com",
      type: "sign-in",
    }),
  );
  const response = await auth.handler(
    httpsRequest("/sign-in/email-otp", {
      email: "user@example.com",
      otp: send.mock.calls[0][0].otp,
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("Secure");
  expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
  await database.update(schema.session).set({ expiresAt: new Date(0) });
  const me = await worker.fetch(
    new Request(`${url}/api/me`, { headers: { cookie: cookieOf(response) } }),
    { ...bindings, BETTER_AUTH_URL: url },
  );
  expect(me.status).toBe(401);
});

test("merchant and banned accounts cannot receive login emails or create sessions", async () => {
  for (const [id, role, banned] of [
    ["merchant", "merchant", false],
    ["disabled", "admin", true],
  ] as const) {
    await database
      .insert(schema.user)
      .values({ id, name: id, email: `${id}@example.com`, role, banned });
    const auth = makeAuth();
    expect((await auth.handler(sendRequest(`${id}@example.com`))).status).toBe(200);
    expect(send).not.toHaveBeenCalled();
    // Even a valid server-generated OTP must not admit a merchant or banned user.
    const otp = await auth.api.createVerificationOTP({
      body: { email: `${id}@example.com`, type: "sign-in" },
    });
    expect(
      (await auth.handler(request("/sign-in/email-otp", { email: `${id}@example.com`, otp })))
        .status,
    ).toBe(403);
    expect(await database.select().from(schema.session)).toHaveLength(0);
  }
});

test("disabled admins lose access and native admin capabilities stay private", async () => {
  await pg.exec(provision);
  const auth = makeAuth();
  await auth.handler(sendRequest());
  const login = await auth.handler(
    request("/sign-in/email-otp", { email: "user@example.com", otp: send.mock.calls[0][0].otp }),
  );
  const cookie = cookieOf(login);
  await database.update(schema.user).set({ banned: true });
  for (const path of ["/api/me", "/api/auth/get-session", "/api/admin/users"]) {
    expect(
      (await worker.fetch(new Request(`${config.url}${path}`, { headers: { cookie } }), bindings))
        .status,
    ).toBe(401);
  }
  for (const path of [
    "/admin/set-role",
    "/admin/create-user",
    "/admin/remove-user",
    "/admin/impersonate-user",
    "/email-otp/create-verification-otp",
  ]) {
    expect((await handleAuth(request(path, {}, cookie), bindings)).status).toBe(404);
  }
});
