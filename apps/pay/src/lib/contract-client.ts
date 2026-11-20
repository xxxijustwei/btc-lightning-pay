import { PaymentProblem, type PaymentErrorCode } from "@btc-lightning-pay/api";
import { Schema } from "effect";
import type { HttpApiEndpoint } from "effect/http-api";

/** Failures the browser detects itself, beside the contract's `PaymentErrorCode`. */
export type ClientErrorCode = "NETWORK" | "TIMEOUT" | "UNEXPECTED_RESPONSE";
export type PublicApiErrorCode = PaymentErrorCode | ClientErrorCode;

/** A failed public API call. Pages branch on `code` and the two classifications, never on HTTP. */
export class PublicApiError extends Error {
  readonly code: PublicApiErrorCode;
  /** Worth sending the same request again: no response, rate limit or a server-side fault. */
  readonly retryable: boolean;
  /** The backend may have acted on the request, so a retry must reuse its idempotency key. */
  readonly outcomeUnknown: boolean;
  constructor(code: PublicApiErrorCode, retryable: boolean, outcomeUnknown: boolean) {
    super(code);
    this.name = "PublicApiError";
    this.code = code;
    this.retryable = retryable;
    this.outcomeUnknown = outcomeUnknown;
  }
}

const TIMEOUT_MS = 15_000;
const failure = (code: PublicApiErrorCode, status: number) =>
  new PublicApiError(
    code,
    status === 0 || status === 429 || status >= 500,
    status === 0 || status >= 500,
  );

type Endpoint = HttpApiEndpoint.Top;
type Field<S> = [S] extends [never] ? never : S extends Schema.Top ? S["Type"] : never;
/** Query fields the contract keeps as strings also accept numbers; they are sent as text. */
type QueryInput<Q> = {
  [K in keyof Q]: string extends Exclude<Q[K], undefined> ? Q[K] | number : Q[K];
};
type Part<Key extends string, T> = [T] extends [never] ? {} : { readonly [K in Key]: T };
export type EndpointInput<E> = Part<"params", Field<HttpApiEndpoint.Params<E>>> &
  Part<"query", QueryInput<Field<HttpApiEndpoint.Query<E>>>> &
  Part<"headers", Field<HttpApiEndpoint.Headers<E>>> &
  Part<"payload", Field<HttpApiEndpoint.Payload<E>>>;
export type EndpointSuccess<E> = Field<HttpApiEndpoint.Success<E>>;
type Call<E> = (
  ...args: {} extends EndpointInput<E>
    ? [input?: EndpointInput<E>, options?: { signal?: AbortSignal }]
    : [input: EndpointInput<E>, options?: { signal?: AbortSignal }]
) => Promise<EndpointSuccess<E>>;
export type ContractClient<Endpoints> = {
  readonly [Name in keyof Endpoints]: Call<Endpoints[Name]>;
};

/** The contract's schemas are plain JSON data and need no services to encode or decode. */
const jsonCodec = (schema: Schema.Top) =>
  Schema.toCodecJson(schema) as unknown as Schema.Codec<unknown>;

function encode(schema: Schema.Top | undefined, value: unknown) {
  if (!schema) return undefined;
  try {
    return Schema.encodeUnknownSync(jsonCodec(schema))(value) as Record<string, unknown>;
  } catch {
    throw failure("INVALID_INPUT", 400);
  }
}

function url(
  endpoint: Endpoint,
  params: Record<string, unknown> | undefined,
  query: Record<string, unknown> | undefined,
) {
  const path = endpoint.path.replace(/:(\w+)/g, (_, key: string) => {
    const value = String(params?.[key] ?? "");
    // Empty and dot segments would change which route the request reaches.
    if (value === "" || value === "." || value === "..") throw failure("INVALID_INPUT", 400);
    return encodeURIComponent(value);
  });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

function decodeSuccess(endpoint: Endpoint, body: unknown) {
  for (const schema of endpoint.success) {
    try {
      return Schema.decodeUnknownSync(jsonCodec(schema))(body);
    } catch {
      // Try the next declared success schema.
    }
  }
  // The backend answered successfully, so it may have acted: report the outcome as unknown.
  throw new PublicApiError("UNEXPECTED_RESPONSE", false, true);
}

const isProblem = Schema.is(PaymentProblem);

async function call(endpoint: Endpoint, input: Record<string, unknown> = {}, signal?: AbortSignal) {
  const query = input.query as Record<string, unknown> | undefined;
  const target = url(
    endpoint,
    encode(endpoint.params, input.params),
    encode(
      endpoint.query,
      query &&
        Object.fromEntries(
          Object.entries(query).map(([k, v]) => [k, typeof v === "number" ? String(v) : v]),
        ),
    ),
  );
  const payloadSchema = [...endpoint.payload.values()][0]?.schemas[0];
  const payload = "payload" in input ? encode(payloadSchema, input.payload) : undefined;
  const headers = new Headers(
    encode(endpoint.headers, input.headers) as Record<string, string> | undefined,
  );
  headers.set("accept", "application/json");
  if (payload !== undefined) headers.set("content-type", "application/json");

  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new DOMException("The request timed out.", "TimeoutError")),
    TIMEOUT_MS,
  );
  const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  let response: Response;
  let text: string;
  try {
    response = await fetch(target, {
      method: endpoint.method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: combined,
    });
    text = await response.text();
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw failure(timeout.signal.aborted ? "TIMEOUT" : "NETWORK", 0);
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = undefined;
  }
  if (!response.ok)
    throw failure(isProblem(body) ? body.code : "UNEXPECTED_RESPONSE", response.status);
  return decodeSuccess(endpoint, body);
}

/** Builds a typed caller for every endpoint of a contract group, keyed by the contract's names. */
export function contractClient<const Endpoints extends Record<string, HttpApiEndpoint.Constraint>>(
  endpoints: Endpoints,
): ContractClient<Endpoints> {
  return Object.fromEntries(
    Object.entries(endpoints).map(([name, endpoint]) => [
      name,
      (input?: Record<string, unknown>, options?: { signal?: AbortSignal }) =>
        call(endpoint as unknown as Endpoint, input, options?.signal),
    ]),
  ) as unknown as ContractClient<Endpoints>;
}
