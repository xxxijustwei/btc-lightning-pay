import type { BreezSdk, Payment } from "@breeztech/breez-sdk-spark/nodejs";
import { Schema } from "effect";
import { WalletPayment } from "@btc-lightning-pay/api";
import { WalletDependencyFailure } from "./errors.ts";

export type SparkSdk = Pick<BreezSdk, "receivePayment" | "parse" | "listPayments" | "getInfo">;
const mismatch = () => new WalletDependencyFailure({ dependency: "breez", reason: "mismatch" });
export function createSparkWallet(sdk: SparkSdk) {
  let payments = new Map<string, Payment>();
  let refreshedAt = 0;
  let refreshing: Promise<void> | undefined;
  async function refresh() {
    if (Date.now() - refreshedAt < 10_000) return;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const next = new Map<string, Payment>();
      // shortcut: rebuild the local SDK index; use a durable incremental index above 100k receipts.
      for (let offset = 0; ; offset += 500) {
        const page = await sdk.listPayments({
          typeFilter: ["receive"],
          statusFilter: ["completed"],
          assetFilter: { type: "bitcoin" },
          sortAscending: true,
          offset,
          limit: 500,
        });
        for (const payment of page.payments) {
          const details = payment.details;
          if (details?.type !== "lightning") continue;
          const hash = details.htlcDetails.paymentHash;
          if (next.has(hash) && next.get(hash)!.id !== payment.id) throw mismatch();
          next.set(hash, payment);
        }
        if (page.payments.length < 500) break;
      }
      payments = next;
      refreshedAt = Date.now();
    })();
    try {
      await refreshing;
    } finally {
      refreshing = undefined;
    }
  }
  async function invoice(orderId: string, amountSat: number, value: string, hash?: string) {
    const parsed = await sdk.parse(value);
    if (
      parsed.type !== "bolt11Invoice" ||
      parsed.network !== "bitcoin" ||
      parsed.amountMsat !== amountSat * 1000 ||
      parsed.description !== `Order ${orderId}` ||
      (hash && parsed.paymentHash !== hash)
    )
      throw mismatch();
    return {
      orderId,
      amountSat,
      invoice: value,
      paymentHash: parsed.paymentHash,
      expiresAt: new Date((parsed.timestamp + parsed.expiry) * 1000).toISOString(),
      paidAt: null,
      receivedMsat: null,
    };
  }
  return {
    async ready() {
      const info = await sdk.getInfo({});
      return (
        !info.lastSyncError &&
        info.lastSyncedAt !== undefined &&
        Date.now() / 1000 - info.lastSyncedAt < 180
      );
    },
    async create(orderId: string, amountSat: number) {
      const response = await sdk.receivePayment({
        paymentMethod: {
          type: "bolt11Invoice",
          description: `Order ${orderId}`,
          amountSats: amountSat,
          expirySecs: 3600,
        },
      });
      return Schema.decodeUnknownSync(WalletPayment)(
        await invoice(orderId, amountSat, response.paymentRequest),
      );
    },
    async find(orderId: string, amountSat: number, paymentHash: string, bolt11: string) {
      const pending = await invoice(orderId, amountSat, bolt11, paymentHash);
      await refresh();
      const payment = payments.get(paymentHash);
      if (!payment) return Schema.decodeUnknownSync(WalletPayment)(pending);
      if (
        payment.paymentType !== "receive" ||
        payment.status !== "completed" ||
        payment.method !== "lightning" ||
        payment.details?.type !== "lightning" ||
        payment.details.invoice !== bolt11 ||
        payment.amount !== BigInt(amountSat) ||
        payment.conversionDetails ||
        payment.details.conversionInfo
      )
        throw mismatch();
      return Schema.decodeUnknownSync(WalletPayment)({
        ...pending,
        paidAt: new Date(payment.timestamp * 1000).toISOString(),
        receivedMsat: Number(payment.amount * 1000n),
      });
    },
  };
}
