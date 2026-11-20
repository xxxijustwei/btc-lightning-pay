import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import type { EndpointInput } from "./contract-client";
import { backendCalls, settle, type PublicEndpoints } from "./public-calls";

/**
 * The payer's three operations, run on this Worker. The browser reaches nothing else of the
 * backend. Input is untrusted here: the contract client encodes every field before sending it on.
 */
const input =
  <Name extends keyof PublicEndpoints>() =>
  (data: EndpointInput<PublicEndpoints[Name]>) => {
    if (typeof data !== "object" || data === null) throw new TypeError("Expected an object.");
    return data;
  };

function backend() {
  setResponseHeader("cache-control", "no-store");
  return backendCalls(getRequest(), env.BACKEND);
}

export const merchantFn = createServerFn({ method: "GET" })
  .validator(input<"merchant">())
  .handler(({ data }) => settle(() => backend().merchant(data)));

export const createOrderFn = createServerFn({ method: "POST" })
  .validator(input<"createOrder">())
  .handler(({ data }) => settle(() => backend().createOrder(data)));

export const orderFn = createServerFn({ method: "GET" })
  .validator(input<"order">())
  .handler(({ data }) => settle(() => backend().order(data)));
