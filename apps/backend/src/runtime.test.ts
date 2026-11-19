import { expect, test } from "vite-plus/test";
import { parseRuntimeConfig } from "./runtime";

test("the database URL is read once: Hyperdrive first, trimmed, PostgreSQL only", () => {
  expect(parseRuntimeConfig({ DATABASE_URL: " postgres://localhost/test " }).databaseUrl).toBe(
    "postgres://localhost/test",
  );
  expect(
    parseRuntimeConfig({
      DATABASE_URL: "postgres://localhost/test",
      HYPERDRIVE: { connectionString: "postgres://localhost/hyperdrive" },
    }).databaseUrl,
  ).toBe("postgres://localhost/hyperdrive");
  for (const DATABASE_URL of [undefined, "", "https://example.com", "not a url"])
    expect(parseRuntimeConfig({ DATABASE_URL }).databaseUrl).toBeUndefined();
});

test("unusable wallet settings leave the wallet unconfigured instead of failing", () => {
  expect(parseRuntimeConfig({ WALLET_URL: "https://wallet.example" }).wallet).toBeUndefined();
  expect(
    parseRuntimeConfig({
      APP_ENV: "development",
      WALLET_URL: "https://wallet.example",
      WALLET_TOKEN: "g".repeat(32),
    }).wallet?.origin,
  ).toBe("https://wallet.example");
});
