import { describe, expect, it } from "vite-plus/test";
import { invoiceCreatedAt } from "./bolt11";

// BOLT11 specification example: timestamp 1496314658.
const SPEC_INVOICE =
  "lnbc1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq9qrsgq357wnc5r2ueh7ck6q93dj32dlqnls087fxdwk8qakdyafkq3yap9us6v52vjjsrvywa6rt52cm9r9zqt8r2t7mlcwspyetp5h2tztugp9lfyql";

describe("invoiceCreatedAt", () => {
  it("reads the creation time encoded in a BOLT11 invoice", () => {
    expect(invoiceCreatedAt(SPEC_INVOICE)).toBe(new Date(1496314658 * 1000).toISOString());
  });

  it("ignores missing or malformed invoices", () => {
    expect(invoiceCreatedAt(null)).toBeNull();
    expect(invoiceCreatedAt("not-an-invoice")).toBeNull();
    expect(invoiceCreatedAt("lnbc1bad")).toBeNull();
  });
});
