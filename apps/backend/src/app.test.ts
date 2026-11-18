import { afterAll, expect, test } from "vite-plus/test";
import { Schema } from "effect";
import { Health } from "@btc-lightning-pay/api";
import { dispose, handler as appHandler } from "./app";

const handler = (request: Request) => appHandler(request);

afterAll(dispose);

test("health endpoint returns the shared response contract", async () => {
  const response = await handler(new Request("http://localhost/api/health"));
  expect(response.status).toBe(200);
  expect(Schema.decodeUnknownSync(Health)(await response.json())).toEqual({ status: "ok" });
});

test("unknown routes return 404", async () => {
  const response = await handler(new Request("http://localhost/api/missing"));
  expect(response.status).toBe(404);
});

test("health is not writable", async () => {
  const response = await handler(new Request("http://localhost/api/health", { method: "POST" }));
  expect(response.status).toBeGreaterThanOrEqual(400);
});

test("the frontend contract rejects malformed health responses", () => {
  expect(() => Schema.decodeUnknownSync(Health)({ status: "failed" })).toThrow();
});
