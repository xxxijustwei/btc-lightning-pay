import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

export const Health = Schema.Struct({ status: Schema.Literal("ok") });

export const Api = HttpApi.make("LightningPayApi").add(
  HttpApiGroup.make("health").add(HttpApiEndpoint.get("get", "/api/health", { success: Health })),
);
