import { Effect } from "effect";

// Native I/O cannot be interrupted atomically. Drain it before completing the request scope.
export function gatewayTask<A>(work: () => Promise<A>): Effect.Effect<A, unknown> {
  return Effect.callback((resume) => {
    const settled = Promise.resolve().then(work).then(Effect.succeed, Effect.fail);
    void settled.then(resume);
    return Effect.promise(() => settled).pipe(Effect.asVoid);
  });
}
