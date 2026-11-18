import { WalletPayment } from "@btc-lightning-pay/api";
import { Schema } from "effect";
import { PaymentFailure, UpstreamFailure } from "./errors";
export function createWalletClient(
  url: string,
  token: string,
  fetcher: typeof fetch = fetch,
  requestId?: string,
) {
  const target = new URL(url);
  if (
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash ||
    (target.protocol !== "https:" &&
      !(target.protocol === "http:" && ["127.0.0.1", "localhost"].includes(target.hostname))) ||
    token.length < 32
  )
    throw new PaymentFailure({ code: "WALLET_NOT_CONFIGURED" });
  return async (
    orderId: string,
    amountSat: number,
    signal?: AbortSignal,
    paymentHash?: string,
    invoice?: string,
  ) => {
    let response: Response;
    try {
      response = await fetcher(
        `${target.origin}${paymentHash ? "/v1/payments/query" : "/v1/invoices"}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            ...(requestId ? { "x-request-id": requestId } : {}),
          },
          body: JSON.stringify({
            orderId,
            amountSat,
            ...(paymentHash ? { paymentHash, invoice } : {}),
          }),
          redirect: "manual",
          signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15_000)]),
        },
      );
    } catch (error) {
      throw new UpstreamFailure({
        dependency: "wallet",
        reason: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network",
      });
    }
    if (response.status === 202) return null;
    if (!response.ok)
      throw new UpstreamFailure({
        dependency: "wallet",
        reason: "http",
        upstreamStatus: response.status,
      });
    let result;
    try {
      result = Schema.decodeUnknownSync(WalletPayment)(await response.json());
    } catch {
      throw new UpstreamFailure({ dependency: "wallet", reason: "invalid_response" });
    }
    if (
      result.orderId !== orderId ||
      result.amountSat !== amountSat ||
      (paymentHash && result.paymentHash !== paymentHash)
    )
      throw new UpstreamFailure({ dependency: "wallet", reason: "mismatch" });
    return result;
  };
}
