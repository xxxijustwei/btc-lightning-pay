import { GatewayInvoice, GatewayPayment, Sats, Millisats } from "@btc-lightning-pay/api/payments";
import { Schema } from "effect";
import type { GatewayConfig } from "./config.ts";
const Incoming = Schema.Struct({
  externalId: Schema.NullOr(Schema.String),
  requestedSat: Schema.NullOr(Sats),
  receivedSat: Millisats,
  fees: Millisats,
  isPaid: Schema.Boolean,
  paymentHash: Schema.String,
  invoice: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.Number),
  completedAt: Schema.NullOr(Schema.Number),
});
export function createPhoenixClient(config: GatewayConfig, fetcher: typeof fetch = fetch) {
  async function call(path: string, body?: URLSearchParams) {
    const response = await fetcher(`${config.phoenixUrl}${path}`, {
      method: body ? "POST" : "GET",
      body,
      headers: { authorization: `Basic ${Buffer.from(`:${config.password}`).toString("base64")}` },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Phoenix unavailable");
    return response.json();
  }
  return {
    async create(orderId: string, amountSat: number) {
      await call(
        "/createinvoice",
        new URLSearchParams({
          amountSat: String(amountSat),
          description: `Order ${orderId}`,
          externalId: orderId,
          expirySeconds: "3600",
        }),
      );
    },
    async find(orderId: string, amountSat: number): Promise<typeof GatewayPayment.Type | null> {
      const list = Schema.decodeUnknownSync(Schema.Array(Incoming))(
        await call(`/payments/incoming?externalId=${encodeURIComponent(orderId)}&all=true&limit=2`),
      );
      if (!list.length) return null;
      if (list.length !== 1) throw new Error("Multiple invoices require reconciliation");
      const payment = list[0];
      if (
        payment.externalId !== orderId ||
        payment.requestedSat !== amountSat ||
        !payment.invoice ||
        !payment.expiresAt
      )
        throw new Error("Invoice mismatch");
      const invoice = Schema.decodeUnknownSync(GatewayInvoice)({
        orderId,
        amountSat,
        paymentHash: payment.paymentHash,
        invoice: payment.invoice,
        expiresAt: new Date(payment.expiresAt).toISOString(),
      });
      const net = amountSat * 1000 - payment.fees;
      const paid =
        payment.isPaid &&
        payment.completedAt !== null &&
        Number.isSafeInteger(net) &&
        net > 0 &&
        Math.floor(net / 1000) === payment.receivedSat;
      if (payment.isPaid && !paid) throw new Error("Payment requires reconciliation");
      return Schema.decodeUnknownSync(GatewayPayment)({
        ...invoice,
        paidAt: paid ? new Date(payment.completedAt!).toISOString() : null,
        receivedMsat: paid ? net : null,
        feeMsat: paid ? payment.fees : null,
      });
    },
  };
}
export function createWorkerClient(config: GatewayConfig, fetcher: typeof fetch = fetch) {
  return async (payment: typeof GatewayPayment.Type) => {
    const response = await fetcher(`${config.workerUrl}/api/internal/payments/sync`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.syncToken}`, "content-type": "application/json" },
      body: JSON.stringify(payment),
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Worker sync unavailable");
  };
}
