import { TZDate } from "@date-fns/tz";
import { addDays, format, isValid } from "date-fns";

/** The admin console shows and filters every time in Beijing time, whatever the browser's zone. */
export const ADMIN_TIME_ZONE = "Asia/Shanghai";

/** Formats an ISO timestamp in Beijing time as `yyyy-MM-dd HH:mm(:ss)`. */
export function formatBeijing(iso: string | null | undefined, withSeconds = true) {
  if (!iso) return "—";
  const date = new TZDate(iso, ADMIN_TIME_ZONE);
  if (!isValid(date)) return "—";
  return format(date, withSeconds ? "yyyy-MM-dd HH:mm:ss" : "yyyy-MM-dd HH:mm");
}

function beijingMidnight(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new TZDate(year!, month! - 1, date!, ADMIN_TIME_ZONE);
}

/** Start of a Beijing calendar day (`yyyy-MM-dd`) as an ISO instant. */
// TZDate#toISOString keeps the +08:00 offset; the API filters take UTC instants.
export function beijingDayStart(day: string) {
  return new Date(beijingMidnight(day).getTime()).toISOString();
}

/** Exclusive end of a Beijing calendar day, for `to` filters. */
export function beijingDayEnd(day: string) {
  return new Date(addDays(beijingMidnight(day), 1).getTime()).toISOString();
}

export function formatSats(sats: number) {
  return sats.toLocaleString("en-US");
}

export function formatMsatAsSats(msat: number) {
  return (msat / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export function formatUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function shortId(id: string) {
  return id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}
