import { UsdCents } from "@btc-lightning-pay/api";
import { Schema } from "effect";

export const PRESET_AMOUNTS_USD = [10, 15, 20, 25, 50, 75, 100, 150, 200, 250, 300] as const;
const isUsdCents = Schema.is(UsdCents);
export const AMOUNT_RANGE_ERROR = "Enter an amount from $1.00 to $300.00.";

export type AmountParse = { ok: true; cents: number } | { ok: false; error: string };

/** Parses a custom USD amount with up to two decimals into integer cents. */
export function parseUsdAmount(input: string): AmountParse {
  const text = input.trim().replace(/^\$/, "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) {
    return { ok: false, error: "Use a number with up to 2 decimals." };
  }
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!isUsdCents(cents)) {
    return { ok: false, error: AMOUNT_RANGE_ERROR };
  }
  return { ok: true, cents };
}

export function formatUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
