/**
 * Display helpers for settlement payouts: networks as people name them, token amounts from their
 * smallest unit, explorer links, and the address checks the backend repeats.
 */
const NETWORK_NAMES: Record<string, string> = {
  arbitrum: "Arbitrum",
  avalanche: "Avalanche",
  base: "Base",
  bsc: "BSC",
  ethereum: "Ethereum",
  hyperevm: "HyperEVM",
  monad: "Monad",
  optimism: "Optimism",
  plasma: "Plasma",
  polygon: "Polygon",
  sei: "Sei",
  solana: "Solana",
  tempo: "Tempo",
  tron: "Tron",
};
/** Commonly used networks first; the rest follow by name. */
const NETWORK_ORDER = ["tron", "ethereum", "solana", "bsc", "base", "arbitrum", "polygon"];

export function networkName(chain: string) {
  return NETWORK_NAMES[chain] ?? chain.charAt(0).toUpperCase() + chain.slice(1);
}

export function compareNetworks(a: string, b: string) {
  const rank = (chain: string) => {
    const index = NETWORK_ORDER.indexOf(chain);
    return index === -1 ? NETWORK_ORDER.length : index;
  };
  return rank(a) - rank(b) || networkName(a).localeCompare(networkName(b));
}

const EXPLORERS: Record<string, { name: string; tx: string }> = {
  ethereum: { name: "Etherscan", tx: "https://etherscan.io/tx/" },
  base: { name: "Basescan", tx: "https://basescan.org/tx/" },
  arbitrum: { name: "Arbiscan", tx: "https://arbiscan.io/tx/" },
  optimism: { name: "Optimism Etherscan", tx: "https://optimistic.etherscan.io/tx/" },
  polygon: { name: "Polygonscan", tx: "https://polygonscan.com/tx/" },
  bsc: { name: "BscScan", tx: "https://bscscan.com/tx/" },
  avalanche: { name: "Snowtrace", tx: "https://snowtrace.io/tx/" },
  solana: { name: "Solscan", tx: "https://solscan.io/tx/" },
  tron: { name: "Tronscan", tx: "https://tronscan.org/#/transaction/" },
};

/** The explorer page of a transaction, for networks with a known explorer. */
export function explorerLink(chain: string, tx: string) {
  const explorer = EXPLORERS[chain];
  return explorer ? { name: explorer.name, href: explorer.tx + encodeURIComponent(tx) } : null;
}

/**
 * A token amount from its smallest unit, rounded to `fraction` digits. A string, because an
 * 18-decimal token's amounts exceed the safe integer range.
 */
export function formatTokenUnits(units: string, decimals: number, fraction = 2) {
  const value = BigInt(units);
  const scale = 10n ** BigInt(decimals);
  const step = decimals > fraction ? 10n ** BigInt(decimals - fraction) : 1n;
  const rounded = ((value + step / 2n) / step) * step;
  const whole = (rounded / scale).toLocaleString("en-US");
  if (fraction === 0) return whole;
  const digits = (rounded % scale).toString().padStart(decimals, "0").slice(0, fraction);
  return `${whole}.${digits.padEnd(fraction, "0")}`;
}

export type AddressFamily = "evm" | "solana" | "tron";
const FAMILY_NAMES: Record<AddressFamily, string> = {
  evm: "EVM",
  solana: "Solana",
  tron: "Tron",
};

/** The address family a pasted address looks like; the wallet checks it again before quoting. */
export function addressFamily(address: string): AddressFamily | null {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return "evm";
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return "tron";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return "solana";
  return null;
}

/** Why `address` cannot receive on `chain`, or undefined when it looks right. */
export function addressProblem(address: string, family: AddressFamily, chain: string) {
  if (!address) return "请填写收款地址。";
  const found = addressFamily(address);
  if (!found) return "地址格式不正确。";
  if (found !== family)
    return `这是 ${FAMILY_NAMES[found]} 地址，与 ${networkName(chain)} 不匹配。`;
  return undefined;
}

/** Whole sats worth `cents` at `rateUsd` dollars per BTC, rounded up. */
export function usdCentsToSats(cents: number, rateUsd: string) {
  return Math.ceil((cents / 100 / Number(rateUsd)) * 1e8);
}

/** Dollars that `sats` are worth at `rateUsd` per BTC, as `$1,234.56`. */
export function satsToUsd(sats: number, rateUsd: string) {
  const usd = (sats / 1e8) * Number(rateUsd);
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
