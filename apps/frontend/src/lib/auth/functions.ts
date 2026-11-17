import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { appendResponseHeader, getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { readCurrentUser } from "./session";

export const getCurrentUser = createServerFn({ method: "GET" }).handler(() => {
  setResponseHeader("cache-control", "private, no-store");
  return readCurrentUser(
    getRequest(),
    (request) => env.BACKEND.fetch(request),
    (cookie) => appendResponseHeader("set-cookie", cookie),
  );
});
