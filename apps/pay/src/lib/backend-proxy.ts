const PUBLIC_PREFIX = "/api/public/";
const dropRequestHeaders = [
  "connection",
  "content-length",
  "cookie",
  "authorization",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];
const dropResponseHeaders = [
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "set-cookie",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

/**
 * Forwards payer requests to the backend Worker. Only the public payment API is
 * reachable from this app; cookies and credentials never cross the boundary.
 */
export async function proxyPublicRequest(
  request: Request,
  backend: { fetch(request: Request): Promise<Response> },
) {
  const incoming = new URL(request.url);
  if (!incoming.pathname.startsWith(PUBLIC_PREFIX)) {
    return Response.json(
      { code: "NOT_FOUND", message: "Not found." },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  const target = new URL("https://backend");
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  const forwarded = new Request(target, request);
  for (const header of dropRequestHeaders) forwarded.headers.delete(header);
  try {
    const response = await backend.fetch(new Request(forwarded, { redirect: "manual" }));
    const headers = new Headers(response.headers);
    for (const header of dropResponseHeaders) headers.delete(header);
    headers.set("cache-control", "no-store");
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return Response.json(
      { code: "BACKEND_UNAVAILABLE", message: "The payment service is unavailable." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
