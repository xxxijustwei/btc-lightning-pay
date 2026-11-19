import { otpThrottle } from "@btc-lightning-pay/db/schema";
import type { Database } from "@btc-lightning-pay/db/client";
import { lt, sql } from "drizzle-orm";

/** Sign-in codes one email address may request per fixed one-hour window. */
export const OTP_REQUESTS_PER_HOUR = 10;

/**
 * Counts a sign-in code request for `email` atomically and reports whether it is allowed. With
 * three guesses per code, this caps guessing at 30 attempts an hour per address, whatever the IP.
 */
export async function takeOtpRequest(database: Database, email: string) {
  const [row] = await database
    .insert(otpThrottle)
    .values({ email, windowStartedAt: sql`now()`, count: 1 })
    .onConflictDoUpdate({
      target: otpThrottle.email,
      set: {
        count: sql`CASE WHEN ${otpThrottle.windowStartedAt} <= now() - interval '1 hour' THEN 1 ELSE ${otpThrottle.count} + 1 END`,
        windowStartedAt: sql`CASE WHEN ${otpThrottle.windowStartedAt} <= now() - interval '1 hour' THEN now() ELSE ${otpThrottle.windowStartedAt} END`,
      },
    })
    .returning({ count: otpThrottle.count });
  return row.count <= OTP_REQUESTS_PER_HOUR;
}

/** Drops windows that have ended; run by the scheduled job. */
export async function pruneOtpThrottle(database: Database) {
  await database
    .delete(otpThrottle)
    .where(lt(otpThrottle.windowStartedAt, sql`now() - interval '1 hour'`));
}
