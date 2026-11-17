import { expect, test } from "vite-plus/test";
import { parseAuthConfig } from "./config";

const env = {
  BETTER_AUTH_URL: "https://pay.example.com",
  BETTER_AUTH_SECRET: "s".repeat(32),
  DATABASE_URL: "postgres://localhost/test",
  RESEND_API_KEY: "test-key",
  AUTH_EMAIL_FROM: "test@example.com",
};
test("auth configuration fails closed and never includes credentials in errors", () => {
  for (const key of Object.keys(env)) {
    expect(() => parseAuthConfig({ ...env, [key]: "" })).toThrow(
      "Authentication configuration is incomplete",
    );
  }
  for (const url of [
    "http://pay.example.com",
    "https://pay.example.com/path",
    "https://secret:password@pay.example.com",
    "https://pay.example.com?x=1",
  ]) {
    expect(() => parseAuthConfig({ ...env, BETTER_AUTH_URL: url })).toThrow(
      "Invalid authentication origin",
    );
  }
  expect(() => parseAuthConfig({ ...env, BETTER_AUTH_SECRET: "short" })).toThrow();
  expect(() => parseAuthConfig({ ...env, DATABASE_URL: "https://example.com" })).toThrow(
    "Invalid database URL",
  );
  expect(parseAuthConfig({ ...env, BETTER_AUTH_URL: "http://127.0.0.1:8787" }).url).toBe(
    "http://127.0.0.1:8787",
  );
});
test("Hyperdrive takes precedence over the local connection", () => {
  expect(
    parseAuthConfig({ ...env, HYPERDRIVE: { connectionString: "postgres://localhost/hyperdrive" } })
      .databaseUrl,
  ).toBe("postgres://localhost/hyperdrive");
});
