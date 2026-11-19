import { Effect } from "effect";
import { PaymentFailure, StorageFailure, UpstreamFailure, type PaymentError } from "./errors";

// Interruption must drain the Promise (and its commit/rollback) before request cleanup.
export function paymentTask<A>(
  operation: string,
  work: (signal: AbortSignal) => Promise<A>,
): Effect.Effect<A, PaymentError> {
  return Effect.callback<A, PaymentError>((resume, signal) => {
    const settled = Promise.resolve()
      .then(() => work(signal))
      .then(
        (value) => Effect.succeed(value),
        (error) =>
          Effect.fail(
            error instanceof PaymentFailure ||
              error instanceof StorageFailure ||
              error instanceof UpstreamFailure
              ? error
              : new StorageFailure({ operation }),
          ),
      );
    void settled.then(resume);
    return Effect.promise(() => settled).pipe(Effect.asVoid);
  });
}
