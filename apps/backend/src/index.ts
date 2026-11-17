import { handler } from "./app";
import { handleAuth } from "./auth/handler";
import type { AuthBindings } from "./auth/config";

export default {
  fetch(request: Request, env: Env & AuthBindings) {
    const path = new URL(request.url).pathname;
    return path.startsWith("/api/auth/") || path === "/api/me"
      ? handleAuth(request, env)
      : handler(request);
  },
} satisfies ExportedHandler<Env & AuthBindings>;
