const hopHeaders = [
  "connection",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

export async function proxyBackendRequest(
  request: Request,
  backend: { fetch(request: Request): Promise<Response> },
) {
  const incoming = new URL(request.url);
  const target = new URL("https://backend");
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  const forwarded = new Request(target, request);
  for (const header of [...hopHeaders, "content-length"]) forwarded.headers.delete(header);
  try {
    const response = await backend.fetch(new Request(forwarded, { redirect: "manual" }));
    const headers = new Headers(response.headers);
    for (const header of [...hopHeaders, "content-encoding", "content-length", "set-cookie"])
      headers.delete(header);
    for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
    headers.set("cache-control", "private, no-store");
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return Response.json(
      { code: "BACKEND_UNAVAILABLE", message: "登录服务暂时不可用，请稍后重试。" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
