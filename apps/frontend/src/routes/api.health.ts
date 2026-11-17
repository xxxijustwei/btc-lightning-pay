import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const response = await env.BACKEND.fetch("https://backend/api/health");
          return new Response(response.body, {
            status: response.status,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        } catch {
          return Response.json({ error: "Backend unavailable" }, { status: 502 });
        }
      },
    },
  },
});
