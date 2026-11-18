const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

/**
 * Creation time a BOLT11 invoice carries in its first 35 data bits, as an ISO string.
 * Display only: the checksum is not verified, so never use this to trust an invoice.
 */
export function invoiceCreatedAt(invoice: string | null): string | null {
  if (!invoice) return null;
  const text = invoice.toLowerCase();
  const separator = text.lastIndexOf("1");
  if (separator < 1) return null;
  const words = text.slice(separator + 1, separator + 8);
  if (words.length < 7) return null;
  let seconds = 0;
  for (const char of words) {
    const value = CHARSET.indexOf(char);
    if (value < 0) return null;
    seconds = seconds * 32 + value;
  }
  return new Date(seconds * 1000).toISOString();
}
