import { handler } from "./app";
import { handleAuth } from "./auth/handler";
import type { AuthBindings } from "./auth/config";
import { handlePayments, type PaymentsBindings } from "./payments/handler";
import { refreshQuote } from "./payments/quote-job";

export default {
  // Every five minutes (wrangler.jsonc): store the BTC quote that order creation reads.
  scheduled(_controller: ScheduledController, env: PaymentsBindings, context: ExecutionContext) {
    context.waitUntil(refreshQuote(env));
  },
  fetch(request: Request, env: AuthBindings & PaymentsBindings) {
    const path = new URL(request.url).pathname;
    if (
      path.startsWith("/api/public/") ||
      path.startsWith("/api/admin/") ||
      path.startsWith("/api/internal/")
    )
      return handlePayments(request, env);
    return path.startsWith("/api/auth/") || path === "/api/me"
      ? handleAuth(request, env)
      : handler(request);
  },
} satisfies ExportedHandler<Env>;
