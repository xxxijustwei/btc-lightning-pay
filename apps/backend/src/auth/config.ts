export type AuthBindings = {
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
  if (!url || !secret || secret.length < 32 || !databaseUrl || !apiKey || !from) {
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
  return { url: origin.origin, secret, databaseUrl, apiKey, from };
}
export type AuthConfig = ReturnType<typeof parseAuthConfig>;
