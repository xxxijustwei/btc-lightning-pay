import { Schema } from "effect";
export type GatewayConfig = {
  token: string;
  phoenixUrl: string;
  password: string;
  host: string;
  port: number;
};
const Token = Schema.String.check(Schema.isMinLength(32));
export function parseConfig(env: NodeJS.ProcessEnv): GatewayConfig {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  const origin = (name: string) => {
    let value: URL;
    try {
      value = new URL(required(name));
    } catch {
      throw new Error(`Invalid ${name}`);
    }
    if (
      value.username ||
      value.password ||
      value.pathname !== "/" ||
      value.search ||
      value.hash ||
      (value.protocol !== "https:" &&
        !(
          value.protocol === "http:" &&
          ["localhost", "127.0.0.1", "phoenixd"].includes(value.hostname)
        ))
    )
      throw new Error(`Invalid ${name}`);
    return value.origin;
  };
  const secret = (name: string) => {
    const value = required(name);
    if (!Schema.is(Token)(value)) throw new Error(`Invalid ${name}`);
    return value;
  };
  const token = secret("GATEWAY_TOKEN");
  const port = Schema.decodeUnknownSync(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  )(Number(env.GATEWAY_PORT ?? 9741));
  return {
    token,
    phoenixUrl: origin("PHOENIX_URL"),
    password: required("PHOENIX_HTTP_PASSWORD"),
    host: env.GATEWAY_HOST ?? "127.0.0.1",
    port,
  };
}
