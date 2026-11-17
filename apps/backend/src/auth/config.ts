export type EmailDelivery = { mode: "console" } | { mode: "resend"; apiKey: string; from: string };

export type AuthBindings = {
  APP_ENV?: string;
  DATABASE_URL?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  HYPERDRIVE?: { connectionString: string };
};
export function parseAuthConfig(env: AuthBindings) {
  const url = env.BETTER_AUTH_URL?.trim();
  const secret = env.BETTER_AUTH_SECRET?.trim();
  const databaseUrl = env.HYPERDRIVE?.connectionString || env.DATABASE_URL?.trim();
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.AUTH_EMAIL_FROM?.trim();
  const environment = env.APP_ENV?.trim() || "production";
  if (environment !== "development" && environment !== "production")
    throw new Error("Invalid application environment");
  if (!url || !secret || secret.length < 32 || !databaseUrl) {
    throw new Error("Authentication configuration is incomplete");
  }
  const origin = new URL(url);
  if (
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
      ))
  ) {
    throw new Error("Invalid authentication origin");
  }
  if (!["postgres:", "postgresql:"].includes(new URL(databaseUrl).protocol))
    throw new Error("Invalid database URL");
  let emailDelivery: EmailDelivery;
  if (apiKey && from) {
    emailDelivery = { mode: "resend", apiKey, from };
  } else if (
    !apiKey &&
    environment === "development" &&
    origin.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
  ) {
    emailDelivery = { mode: "console" };
  } else {
    throw new Error("Authentication configuration is incomplete");
  }
  return { url: origin.origin, secret, databaseUrl, emailDelivery };
}
export type AuthConfig = ReturnType<typeof parseAuthConfig>;
