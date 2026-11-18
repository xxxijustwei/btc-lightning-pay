import { PublicMerchant, PublicOrder } from "@btc-lightning-pay/api";
import { Schema } from "effect";

export type PublicMerchantData = typeof PublicMerchant.Type;
export type PublicOrderData = typeof PublicOrder.Type;

/** A failed public API call. `status` 0 means the request never got a response. */
export class PublicApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PublicApiError";
    this.status = status;
    this.code = code;
  }
  /** Worth retrying with the same request: network failure, rate limit or a server-side fault. */
  get retryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

const decodeMerchant = Schema.decodeUnknownSync(PublicMerchant);
const decodeOrder = Schema.decodeUnknownSync(PublicOrder);

async function request<T>(
  path: string,
  init: RequestInit,
  decode: (input: unknown) => T,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { accept: "application/json", ...init.headers },
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
    });
  } catch (cause) {
    if (init.signal?.aborted) throw cause;
    throw new PublicApiError(0, "NETWORK", "Can't reach the payment service.");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = body as { code?: unknown; message?: unknown } | null;
    throw new PublicApiError(
      response.status,
      typeof problem?.code === "string" ? problem.code : `HTTP_${response.status}`,
      typeof problem?.message === "string" ? problem.message : "Request failed.",
    );
  }
  return decode(body);
}

export function getMerchant(slug: string, signal?: AbortSignal) {
  return request(`/api/public/merchants/${encodeURIComponent(slug)}`, { signal }, decodeMerchant);
}

export function createOrder(
  slug: string,
  input: { amountUsdCents: number },
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  return request(
    `/api/public/merchants/${encodeURIComponent(slug)}/orders`,
    {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(input),
    },
    decodeOrder,
  );
}

export function getOrder(orderId: string, signal?: AbortSignal) {
  return request(`/api/public/orders/${encodeURIComponent(orderId)}`, { signal }, decodeOrder);
}
