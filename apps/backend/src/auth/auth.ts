import { AUTH_COOKIE_PREFIX } from "@btc-lightning-pay/api";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { Database } from "@btc-lightning-pay/db/client";
import * as schema from "@btc-lightning-pay/db/schema";
import type { AuthConfig } from "./config";
import { OTP_EXPIRATION_SECONDS, type SendOTP } from "./email";

export function createAuth(
  config: Pick<AuthConfig, "url" | "secret">,
  database: Database,
  sendOTP: SendOTP,
) {
  return betterAuth({
    appName: "BTC Lightning Pay",
    baseURL: config.url,
    basePath: "/api/auth",
    secret: config.secret,
    trustedOrigins: [config.url],
    database: drizzleAdapter(database, { provider: "pg", schema, transaction: true }),
    emailAndPassword: { enabled: false },
    session: { cookieCache: { enabled: false } },
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      disableOriginCheck: false,
      useSecureCookies: config.url.startsWith("https:"),
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    rateLimit: { enabled: false },
    logger: { disabled: true },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/email-otp/send-verification-otp" && ctx.body?.type !== "sign-in") {
          throw new APIError("BAD_REQUEST", { message: "Unsupported verification flow" });
        }
      }),
    },
    plugins: [
      emailOTP({
        disableSignUp: true,
        otpLength: 6,
        expiresIn: OTP_EXPIRATION_SECONDS,
        allowedAttempts: 3,
        storeOTP: "hashed",
        sendVerificationOTP: async ({ email, otp }) => sendOTP({ email, otp }),
      }),
    ],
  });
}
