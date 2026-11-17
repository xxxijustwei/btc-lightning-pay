import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { proxyBackendRequest } from "../lib/api/backend-proxy";

export const Route = createFileRoute("/api/me")({
  server: { handlers: { GET: ({ request }) => proxyBackendRequest(request, env.BACKEND) } },
});
