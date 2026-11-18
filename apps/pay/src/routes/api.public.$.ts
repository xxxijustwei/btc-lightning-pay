import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { proxyPublicRequest } from "../lib/backend-proxy";

export const Route = createFileRoute("/api/public/$")({
  server: {
    handlers: {
      GET: ({ request }) => proxyPublicRequest(request, env.BACKEND),
      POST: ({ request }) => proxyPublicRequest(request, env.BACKEND),
    },
  },
});
