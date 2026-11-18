const beijing = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** Formats an ISO timestamp in Beijing time as `YYYY-MM-DD HH:mm:ss`. */
export function formatBeijing(iso: string | null | undefined, withSeconds = true) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = Object.fromEntries(
    beijing.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const time = withSeconds
    ? `${parts.hour}:${parts.minute}:${parts.second}`
    : `${parts.hour}:${parts.minute}`;
  return `${parts.year}-${parts.month}-${parts.day} ${time}`;
}

/** Turns a Beijing calendar date (YYYY-MM-DD) into the ISO instant at its start. */
export function beijingDayStart(date: string) {
  return new Date(`${date}T00:00:00+08:00`).toISOString();
}

/** Exclusive end of a Beijing calendar date. */
export function beijingDayEnd(date: string) {
  return new Date(new Date(`${date}T00:00:00+08:00`).getTime() + 86_400_000).toISOString();
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
