import { expect, test } from "vite-plus/test";
import { bigintSatsToMsat, excessMsat, Millisats, msatToSats, Sats, satsToMsat } from "./payments";

test("the largest order amount still converts to an exact millisatoshi amount", () => {
  expect(satsToMsat(Sats.make(1))).toBe(1000);
  expect(satsToMsat(Sats.make(9_007_199_254_740))).toBe(9_007_199_254_740_000);
  expect(Number.isSafeInteger(satsToMsat(Sats.make(9_007_199_254_740)))).toBe(true);
});

test("only whole, in-range satoshi amounts come back from millisatoshis", () => {
  expect(msatToSats(10_000_000)).toBe(10_000);
  expect(msatToSats(10_000_500)).toBeUndefined();
  expect(msatToSats(0)).toBeUndefined();
  expect(msatToSats(Number.MAX_SAFE_INTEGER)).toBeUndefined();
});

test("a wallet's bigint satoshis convert only while the result stays a safe integer", () => {
  expect(bigintSatsToMsat(12_000n)).toBe(12_000_000);
  expect(() => bigintSatsToMsat(9_007_199_254_741n)).toThrow(RangeError);
  expect(() => bigintSatsToMsat(-1n)).toThrow(RangeError);
});

test("excess is what arrived above the invoice and never negative", () => {
  expect(excessMsat(Millisats.make(12_000_000), Sats.make(10_000))).toBe(2_000_000);
  expect(excessMsat(Millisats.make(10_000_000), Sats.make(10_000))).toBe(0);
  expect(() => excessMsat(Millisats.make(9_999_000), Sats.make(10_000))).toThrow();
});
