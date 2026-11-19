import { handler } from "./app";
import { handleAuth } from "./auth/handler";
import { handlePayments, type PaymentsBindings } from "./payments/handler";
import { runScheduled } from "./payments/jobs";

export default {
  // Every minute (wrangler.jsonc): payment sync, cleanup, and a BTC quote every fifth minute.
  scheduled(controller: ScheduledController, env: PaymentsBindings, context: ExecutionContext) {
    context.waitUntil(runScheduled(env, controller.scheduledTime));
  },
  fetch(request: Request, env: PaymentsBindings) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/public/") || path.startsWith("/api/admin/"))
      return handlePayments(request, env);
    return path.startsWith("/api/auth/") || path === "/api/me"
      ? handleAuth(request, env)
      : handler(request);
  },
} satisfies ExportedHandler<Env>;
