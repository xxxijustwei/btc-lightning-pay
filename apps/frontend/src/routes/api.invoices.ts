import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { proxyBackendRequest } from "../lib/api/backend-proxy";

export const Route = createFileRoute("/api/invoices")({
  server: { handlers: { POST: ({ request }) => proxyBackendRequest(request, env.BACKEND) } },
});
