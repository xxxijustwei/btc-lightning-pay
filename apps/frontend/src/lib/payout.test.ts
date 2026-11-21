import { expect, test } from "vite-plus/test";
import {
  addressProblem,
  compareNetworks,
  explorerLink,
  formatTokenUnits,
  satsToUsd,
  usdCentsToSats,
} from "./payout";

test("token amounts format from their smallest unit, 18 decimals included", () => {
  expect(formatTokenUnits("57590000", 6)).toBe("57.59");
  expect(formatTokenUnits("296950", 6)).toBe("0.30");
  expect(formatTokenUnits("1234567890000", 6)).toBe("1,234,567.89");
  // BNB chain's USDT: beyond the safe integer range.
  expect(formatTokenUnits("327450000000000000000", 18)).toBe("327.45");
  expect(formatTokenUnits("0", 6)).toBe("0.00");
});

test("addresses must belong to the network's family", () => {
  const evm = "0x1111111111111111111111111111111111111111";
  const tron = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
  const solana = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
  expect(addressProblem(evm, "evm", "base")).toBeUndefined();
  expect(addressProblem(tron, "tron", "tron")).toBeUndefined();
  expect(addressProblem(solana, "solana", "solana")).toBeUndefined();
  expect(addressProblem(evm, "tron", "tron")).toBe("这是 EVM 地址，与 Tron 不匹配。");
  expect(addressProblem("0x12", "evm", "base")).toBe("地址格式不正确。");
  expect(addressProblem("", "evm", "base")).toBe("请填写收款地址。");
});

test("common networks come first, the rest by name", () => {
  expect(["monad", "base", "arbitrum", "tron", "avalanche"].sort(compareNetworks)).toEqual([
    "tron",
    "base",
    "arbitrum",
    "avalanche",
    "monad",
  ]);
  expect(explorerLink("base", "0xabc")).toEqual({
    name: "Basescan",
    href: "https://basescan.org/tx/0xabc",
  });
  expect(explorerLink("monad", "0xabc")).toBeNull();
});

test("dollar limits convert to sats at the stored price", () => {
  expect(usdCentsToSats(80, "91000")).toBe(880);
  expect(satsToUsd(361_690, "91000")).toBe("$329.14");
});
