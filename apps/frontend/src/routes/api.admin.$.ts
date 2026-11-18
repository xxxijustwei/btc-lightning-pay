import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { proxyBackendRequest } from "../lib/api/backend-proxy";

// Same-origin admin API. The backend checks the session, admin role and the Origin of writes.
export const Route = createFileRoute("/api/admin/$")({
  server: {
    handlers: {
      GET: ({ request }) => proxyBackendRequest(request, env.BACKEND),
      POST: ({ request }) => proxyBackendRequest(request, env.BACKEND),
      PATCH: ({ request }) => proxyBackendRequest(request, env.BACKEND),
    },
  },
});
