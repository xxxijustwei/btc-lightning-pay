import { handler } from "./app";
import { handleAuth } from "./auth/handler";
import type { AuthBindings } from "./auth/config";
import { Context } from "effect";
import { createPhoenix, Phoenix, type PhoenixBindings } from "./phoenix";

export default {
  fetch(request: Request, env: AuthBindings & PhoenixBindings) {
    const path = new URL(request.url).pathname;
    return path.startsWith("/api/auth/") || path === "/api/me"
      ? handleAuth(request, env)
      : handler(request, Context.make(Phoenix, createPhoenix(env)));
  },
} satisfies ExportedHandler<Env>;
