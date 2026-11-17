import { GatewayPayment, Sats, Millisats } from "@btc-lightning-pay/api/payments";
import { Schema } from "effect";
import { GatewayDependencyFailure } from "./errors.ts";
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
    let response: Response;
    try {
      response = await fetcher(`${config.phoenixUrl}${path}`, {
        method: body ? "POST" : "GET",
        body,
        headers: {
          authorization: `Basic ${Buffer.from(`:${config.password}`).toString("base64")}`,
        },
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new GatewayDependencyFailure({
        dependency: "phoenix",
        reason: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network",
      });
    }
    if (!response.ok)
      throw new GatewayDependencyFailure({
        dependency: "phoenix",
        reason: "http",
        upstreamStatus: response.status,
      });
    try {
      return await response.json();
    } catch {
      throw new GatewayDependencyFailure({ dependency: "phoenix", reason: "invalid_response" });
    }
  }
  return {
    async create(orderId: string, amountSat: number) {
      const result = await call(
        "/createinvoice",
        new URLSearchParams({
          amountSat: String(amountSat),
          description: `Order ${orderId}`,
          externalId: orderId,
          expirySeconds: "3600",
        }),
      );
      let paymentHash: string;
      try {
        paymentHash = Schema.decodeUnknownSync(
          Schema.Struct({ paymentHash: GatewayPayment.fields.paymentHash }),
        )(result).paymentHash;
      } catch {
        throw new GatewayDependencyFailure({ dependency: "phoenix", reason: "invalid_response" });
      }
      return this.find(orderId, amountSat, paymentHash);
    },
    async find(
      orderId: string,
      amountSat: number,
      paymentHash: string,
    ): Promise<typeof GatewayPayment.Type | null> {
      const raw = await call(`/payments/incoming/${encodeURIComponent(paymentHash)}`);
      let payment;
      try {
        payment = Schema.decodeUnknownSync(Incoming)(raw);
      } catch {
        throw new GatewayDependencyFailure({ dependency: "phoenix", reason: "invalid_response" });
      }
      if (
        payment.externalId !== orderId ||
        payment.paymentHash !== paymentHash ||
        payment.requestedSat !== amountSat ||
        !payment.invoice ||
        !payment.expiresAt
      )
        throw new GatewayDependencyFailure({ dependency: "phoenix", reason: "mismatch" });
      const net = amountSat * 1000 - payment.fees;
      const paid =
        payment.isPaid &&
        payment.completedAt !== null &&
        Number.isSafeInteger(net) &&
        net > 0 &&
        Math.floor(net / 1000) === payment.receivedSat;
      if (payment.isPaid && !paid)
        throw new GatewayDependencyFailure({ dependency: "phoenix", reason: "mismatch" });
      try {
        return Schema.decodeUnknownSync(GatewayPayment)({
          orderId,
          amountSat,
          paymentHash: payment.paymentHash,
          invoice: payment.invoice,
          expiresAt: new Date(payment.expiresAt).toISOString(),
          paidAt: paid ? new Date(payment.completedAt!).toISOString() : null,
          receivedMsat: paid ? net : null,
          feeMsat: paid ? payment.fees : null,
        });
      } catch {
        throw new GatewayDependencyFailure({ dependency: "phoenix", reason: "invalid_response" });
      }
    },
  };
}
