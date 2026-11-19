import { createDatabase } from "@btc-lightning-pay/db/client";
import { Context, Effect, Layer } from "effect";
import { createCrediting, type Crediting } from "./payments/crediting";
import { PaymentFailure } from "./payments/errors";
import { createOrderIntake, type OrderIntake, type Quote } from "./payments/intake";
import { paymentLogger, type PaymentLog } from "./payments/logging";
import { createQuoteSource } from "./payments/quote";
import { createPaymentService } from "./payments/service";
import { createPaymentStore, transactionRunner } from "./payments/store";
import {
  makeWallet,
  parseWalletConfig,
  Wallet,
  type WalletBindings,
  type WalletConfig,
} from "./payments/wallet";

export type DatabaseBindings = {
  /** Cloudflare Hyperdrive in front of PostgreSQL; preferred over `DATABASE_URL`. */
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string;
};
export type RuntimeBindings = DatabaseBindings & WalletBindings;
/** Opens a database connection; tests pass one backed by PGlite. */
export type Connect = (url: string) => ReturnType<typeof createDatabase>;
/** What one request or scheduled run brings with it. */
export type Invocation = {
  requestId: string;
  /** Aborts storage work when the request is cancelled. */
  signal?: AbortSignal;
  /** Outbound fetch for the wallet and quote calls; defaults to the global one. */
  fetcher?: typeof fetch;
};

/**
 * Reads the runtime settings from the Worker's bindings once. Either part is absent when its
 * settings are missing or unusable; callers decide what that means for them.
 */
export function parseRuntimeConfig(env: RuntimeBindings): {
  databaseUrl?: string;
  wallet?: WalletConfig;
} {
  const raw = env.HYPERDRIVE?.connectionString || env.DATABASE_URL?.trim();
  let databaseUrl: string | undefined;
  try {
    if (raw && ["postgres:", "postgresql:"].includes(new URL(raw).protocol)) databaseUrl = raw;
  } catch {
    // An unparsable URL is treated as missing.
  }
  let wallet: WalletConfig | undefined;
  try {
    wallet = parseWalletConfig(env);
  } catch {
    // The Wallet then fails every call as `not_configured`.
  }
  return { databaseUrl, wallet };
}

/** The invocation's database connection, closed when the invocation ends. */
export class Database extends Context.Service<
  Database,
  { database: ReturnType<typeof createDatabase>["database"] }
>()("backend/Database") {}
/** The invocation's failure log, tagged with its request id. */
export class RequestLog extends Context.Service<RequestLog, { log: PaymentLog }>()(
  "backend/RequestLog",
) {}
export class QuoteSource extends Context.Service<
  QuoteSource,
  { quote: (signal?: AbortSignal) => Promise<Quote> }
>()("backend/QuoteSource") {}
/** The payment modules, built over the invocation's database. */
export class Payments extends Context.Service<
  Payments,
  {
    store: ReturnType<typeof createPaymentStore>;
    crediting: Crediting;
    payments: ReturnType<typeof createPaymentService>;
    intake: OrderIntake;
  }
>()("backend/Payments") {}

/**
 * Opens the database for one invocation and closes it afterwards. Fails `PAYMENTS_NOT_CONFIGURED`
 * when no usable URL is set; a failed close is logged, never thrown.
 */
export function databaseLayer(
  databaseUrl: string | undefined,
  log: PaymentLog,
  connect: Connect = createDatabase,
): Layer.Layer<Database, PaymentFailure> {
  return Layer.effect(
    Database,
    Effect.acquireRelease(
      databaseUrl
        ? Effect.sync(() => connect(databaseUrl))
        : Effect.fail(new PaymentFailure({ code: "PAYMENTS_NOT_CONFIGURED" })),
      (resource) =>
        Effect.tryPromise(() => resource.close()).pipe(
          Effect.catch(() =>
            Effect.sync(() => log({ operation: "close_database", code: "STORAGE_FAILURE" })),
          ),
        ),
    ).pipe(Effect.map((resource) => Database.of({ database: resource.database }))),
  );
}

const paymentsLayer = (signal?: AbortSignal) =>
  Layer.effect(
    Payments,
    Effect.gen(function* () {
      const { database } = yield* Database;
      const { log } = yield* RequestLog;
      const { quote } = yield* QuoteSource;
      const store = createPaymentStore(database, signal);
      const crediting = createCrediting(store, log);
      return Payments.of({
        store,
        crediting,
        payments: createPaymentService(store, crediting),
        intake: createOrderIntake({
          transaction: transactionRunner(database, signal),
          crediting,
          quote,
          log,
        }),
      });
    }),
  );

/** Shared by the requests one Worker instance serves: its 60 s cache holds no I/O object. */
const sharedQuote = createQuoteSource();

/**
 * Everything one request or scheduled run needs, built from the bindings and released when it
 * ends. Nothing here outlives the invocation: Workers cannot share I/O objects across requests.
 */
export function runtimeLayer(
  env: RuntimeBindings,
  invocation: Invocation,
  connect: Connect = createDatabase,
) {
  const config = parseRuntimeConfig(env);
  const log = paymentLogger(invocation.requestId);
  const base = Layer.mergeAll(
    databaseLayer(config.databaseUrl, log, connect),
    Layer.succeed(RequestLog, { log }),
    Layer.succeed(QuoteSource, {
      // A run with its own fetcher gets a fresh source: no cached price from another run.
      quote: invocation.fetcher ? createQuoteSource(invocation.fetcher) : sharedQuote,
    }),
    Layer.succeed(
      Wallet,
      makeWallet(config.wallet, {
        requestId: invocation.requestId,
        fetcher: invocation.fetcher,
      }),
    ),
  );
  return paymentsLayer(invocation.signal).pipe(Layer.provideMerge(base));
}
