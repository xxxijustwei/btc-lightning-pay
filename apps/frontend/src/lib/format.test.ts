import { describe, expect, it } from "vite-plus/test";
import { beijingDayEnd, beijingDayStart, formatBeijing, formatMsatAsSats, shortId } from "./format";

describe("format helpers", () => {
  it("shows UTC timestamps in Beijing time", () => {
    expect(formatBeijing("2026-11-17T10:05:12.348Z")).toBe("2026-11-17 18:05:12");
    expect(formatBeijing("2026-11-17T16:30:00Z", false)).toBe("2026-11-18 00:30");
    expect(formatBeijing(null)).toBe("—");
  });

  it("filters whole Beijing calendar days with an exclusive end", () => {
    expect(beijingDayStart("2026-11-10")).toBe("2026-11-09T16:00:00.000Z");
    expect(beijingDayEnd("2026-11-17")).toBe("2026-11-17T16:00:00.000Z");
  });

  it("formats millisatoshis and long ids", () => {
    expect(formatMsatAsSats(27_400_000)).toBe("27,400");
    expect(formatMsatAsSats(1_500)).toBe("1.5");
    expect(shortId("7f3c2a91-4b6e-4d0a-9c1f-2e85b7d39abc")).toBe("7f3c2a91…9abc");
  });
});
