import type { BreezSdk, ListPaymentsRequest, Payment } from "@breeztech/breez-sdk-spark/nodejs";
import { Schema } from "effect";
import {
  bigintSatsToMsat,
  msatToSats,
  satsToMsat,
  WalletPayment,
  type Sats,
} from "@btc-lightning-pay/api";
import { WalletDependencyFailure, logWalletAnomaly } from "./errors.ts";

export type SparkSdk = Pick<BreezSdk, "receivePayment" | "parse" | "listPayments" | "getInfo">;
const mismatch = () => new WalletDependencyFailure({ dependency: "breez", reason: "mismatch" });
const PAGE = 500;
const orderDescription =
  /^Order ([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const completedReceipts = {
  typeFilter: ["receive"],
  statusFilter: ["completed"],
  assetFilter: { type: "bitcoin" },
  sortAscending: true,
} satisfies ListPaymentsRequest;

/** True when a completed SDK receipt can settle an invoice of `amountSat`; overpayment counts. */
function settles(payment: Payment, bolt11: string, amountSat: Sats) {
  return (
    payment.paymentType === "receive" &&
    payment.status === "completed" &&
    payment.method === "lightning" &&
    payment.details?.type === "lightning" &&
    payment.details.invoice === bolt11 &&
    payment.amount >= BigInt(amountSat) &&
    !payment.conversionDetails &&
    !payment.details.conversionInfo
  );
}
const received = (payment: Payment) => ({
  paidAt: new Date(payment.timestamp * 1000).toISOString(),
  receivedMsat: bigintSatsToMsat(payment.amount),
});

export function createSparkWallet(sdk: SparkSdk) {
  async function invoice(orderId: string, amountSat: Sats, value: string, hash?: string) {
    const parsed = await sdk.parse(value);
    if (
      parsed.type !== "bolt11Invoice" ||
      parsed.network !== "bitcoin" ||
      parsed.amountMsat !== satsToMsat(amountSat) ||
      parsed.description !== `Order ${orderId}` ||
      (hash && parsed.paymentHash !== hash)
    )
      throw mismatch();
    return {
      issuedAt: parsed.timestamp,
      payment: {
        orderId,
        amountSat,
        invoice: value,
        paymentHash: parsed.paymentHash,
        expiresAt: new Date((parsed.timestamp + parsed.expiry) * 1000).toISOString(),
        paidAt: null,
        receivedMsat: null,
      },
    };
  }
  /** Receipts completed between two Unix times, read page by page; a window spans one invoice's life. */
  async function receiptsBetween(from: number, to: number) {
    const found: Payment[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await sdk.listPayments({
        ...completedReceipts,
        fromTimestamp: from,
        toTimestamp: to,
        offset,
        limit: PAGE,
      });
      found.push(...page.payments);
      if (page.payments.length < PAGE) return found;
    }
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
    async create(orderId: string, amountSat: Sats) {
      const response = await sdk.receivePayment({
        paymentMethod: {
          type: "bolt11Invoice",
          description: `Order ${orderId}`,
          amountSats: amountSat,
          expirySecs: 3600,
        },
      });
      const { payment } = await invoice(orderId, amountSat, response.paymentRequest);
      return Schema.decodeUnknownSync(WalletPayment)(payment);
    },
    async find(orderId: string, amountSat: Sats, paymentHash: string, bolt11: string) {
      const { issuedAt, payment: pending } = await invoice(orderId, amountSat, bolt11, paymentHash);
      // A payment completes while its invoice is valid; the margins cover clock skew and claiming.
      const expiresAt = Date.parse(pending.expiresAt) / 1000;
      const matches = (await receiptsBetween(issuedAt - 60, expiresAt + 300)).filter(
        (payment) =>
          payment.details?.type === "lightning" &&
          payment.details.htlcDetails.paymentHash === paymentHash,
      );
      if (!matches.length) return Schema.decodeUnknownSync(WalletPayment)(pending);
      if (matches.length > 1 || !settles(matches[0], bolt11, amountSat)) throw mismatch();
      return Schema.decodeUnknownSync(WalletPayment)({ ...pending, ...received(matches[0]) });
    },
    /**
     * One page of completed receipts at or after `since`, for the Worker's payment sync. Receipts
     * that are not order invoices, or do not settle theirs, are skipped and logged, never fatal.
     */
    async completed(since: number) {
      const page = await sdk.listPayments({
        ...completedReceipts,
        fromTimestamp: since,
        offset: 0,
        limit: PAGE,
      });
      const payments = [];
      let latest: number | null = null;
      for (const payment of page.payments) {
        latest = Math.max(latest ?? 0, payment.timestamp);
        if (payment.details?.type !== "lightning") continue;
        const bolt11 = payment.details.invoice;
        const parsed = await sdk.parse(bolt11).catch(() => null);
        const orderId =
          parsed?.type === "bolt11Invoice"
            ? orderDescription.exec(parsed.description ?? "")?.[1]
            : undefined;
        if (!parsed || parsed.type !== "bolt11Invoice" || !orderId) continue;
        const amountSat = msatToSats(parsed.amountMsat ?? 0);
        try {
          if (amountSat === undefined) throw mismatch();
          const { payment: pending } = await invoice(orderId, amountSat, bolt11);
          if (
            pending.paymentHash !== payment.details.htlcDetails.paymentHash ||
            !settles(payment, bolt11, amountSat)
          )
            throw mismatch();
          payments.push(
            Schema.decodeUnknownSync(WalletPayment)({ ...pending, ...received(payment) }),
          );
        } catch {
          logWalletAnomaly({ operation: "list_completed", orderId });
        }
      }
      return { payments, latest, more: page.payments.length === PAGE };
    },
  };
}
