import { AUTH_COOKIE_PREFIX } from "@btc-lightning-pay/api";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { admin, emailOTP } from "better-auth/plugins";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import { eq } from "drizzle-orm";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { Database } from "@btc-lightning-pay/db/client";
import * as schema from "@btc-lightning-pay/db/schema";
import type { AuthConfig } from "./config";
import { OTP_EXPIRATION_SECONDS, type SendOTP } from "./email";
import { takeOtpRequest } from "./throttle";

/**
 * Per-IP limits on the code endpoints, counted in the database so every Worker isolate shares
 * them; the per-email limit in `takeOtpRequest` covers attackers who rotate addresses.
 */
export const AUTH_RATE_LIMITS = {
  "/email-otp/send-verification-otp": { window: 600, max: 5 },
  "/sign-in/email-otp": { window: 600, max: 10 },
  // Session reads back every page load and carry no guessable secret.
  "/get-session": false,
} as const;

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
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: AUTH_RATE_LIMITS,
    },
    logger: { disabled: true },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/email-otp/send-verification-otp") return;
        if (ctx.body?.type !== "sign-in")
          throw new APIError("BAD_REQUEST", { message: "Unsupported verification flow" });
        const email =
          typeof ctx.body?.email === "string" ? ctx.body.email.trim().toLowerCase() : "";
        if (email && !(await takeOtpRequest(database, email)))
          throw new APIError("TOO_MANY_REQUESTS", { message: "Too many sign-in codes requested" });
      }),
    },
    databaseHooks: {
      session: {
        create: {
          before: async (value) => {
            const [user] = await database
              .select()
              .from(schema.user)
              .where(eq(schema.user.id, value.userId));
            if (!user || user.role !== "admin" || user.banned)
              throw new APIError("FORBIDDEN", { message: "Login unavailable" });
          },
        },
      },
    },
    plugins: [
      admin({
        defaultRole: "merchant",
        adminRoles: ["admin"],
        roles: { admin: adminAc, merchant: userAc },
      }),
      emailOTP({
        disableSignUp: true,
        otpLength: 6,
        expiresIn: OTP_EXPIRATION_SECONDS,
        allowedAttempts: 3,
        storeOTP: "hashed",
        sendVerificationOTP: async ({ email, otp }) => {
          const [user] = await database
            .select()
            .from(schema.user)
            .where(eq(schema.user.email, email.toLowerCase()));
          if (user?.role === "admin" && !user.banned) await sendOTP({ email, otp });
        },
      }),
    ],
  });
}
