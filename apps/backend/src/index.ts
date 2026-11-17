import { handler } from "./app";
import { handleAuth } from "./auth/handler";
import type { AuthBindings } from "./auth/config";
import { Context } from "effect";
import { createPhoenix, Phoenix, type PhoenixBindings } from "./phoenix";
import { handlePayments, type PaymentsBindings } from "./payments/handler";
import { recoverOrders } from "./payments/recovery";

export default {
  scheduled(_event: ScheduledController, env: PaymentsBindings, context: ExecutionContext) {
    context.waitUntil(recoverOrders(env));
  },
  fetch(request: Request, env: AuthBindings & PhoenixBindings & PaymentsBindings) {
    const path = new URL(request.url).pathname;
    if (
      path.startsWith("/api/public/") ||
      path.startsWith("/api/admin/") ||
      path.startsWith("/api/internal/")
    )
      return handlePayments(request, env);
    return path.startsWith("/api/auth/") || path === "/api/me"
      ? handleAuth(request, env)
      : handler(request, Context.make(Phoenix, createPhoenix(env)));
  },
} satisfies ExportedHandler<Env>;
