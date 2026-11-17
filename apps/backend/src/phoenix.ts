import { CreateInvoiceInput, Invoice, InvoiceUnavailable } from "@btc-lightning-pay/api";
import { Context, Effect, Schema } from "effect";

export type PhoenixBindings = {
  APP_ENV?: string;
  PHOENIX_HTTP_PASSWORD?: string;
};

export class Phoenix extends Context.Service<
  Phoenix,
  {
    create: (
      input: typeof CreateInvoiceInput.Type,
    ) => Effect.Effect<typeof Invoice.Type, typeof InvoiceUnavailable.Type>;
  }
>()("backend/Phoenix") {}

export function createPhoenix(env: PhoenixBindings): typeof Phoenix.Service {
  return {
    create: (input) =>
      Effect.tryPromise({
        try: async (signal) => {
          // shortcut: unauthenticated demo is local-only; add authorization before deployment.
          if (env.APP_ENV !== "development" || !env.PHOENIX_HTTP_PASSWORD)
            throw new Error("Demo not configured");
          const response = await fetch("http://127.0.0.1:9740/createinvoice", {
            method: "POST",
            redirect: "manual",
            signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
            headers: { authorization: `Basic ${btoa(`:${env.PHOENIX_HTTP_PASSWORD}`)}` },
            body: new URLSearchParams({
              amountSat: String(input.amountSat),
              description: input.description,
              expirySeconds: "3600",
            }),
          });
          if (!response.ok) throw new Error("Phoenix request failed");
          const invoice = Schema.decodeUnknownSync(Invoice)(await response.json());
          if (invoice.amountSat !== input.amountSat) throw new Error("Invoice amount mismatch");
          return invoice;
        },
        catch: () => ({
          code: "INVOICE_UNAVAILABLE" as const,
          message: "开票失败，请检查本地 phoenixd 连接与配置。请求不会自动重试。",
        }),
      }),
  };
}
