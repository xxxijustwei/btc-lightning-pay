import { createFileRoute, redirect } from "@tanstack/react-router";
import { authQueryOptions } from "../lib/auth/queries";
import { AuthError } from "../modules/auth/auth-error";
import { SignInPage } from "../modules/auth/sign-in-page";

export const Route = createFileRoute("/sign-in")({
  head: () => ({ meta: [{ title: "登录 · BTC Lightning Pay" }] }),
  headers: () => ({ "cache-control": "private, no-store" }),
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.fetchQuery(authQueryOptions());
    if (user) throw redirect({ to: "/", replace: true });
  },
  errorComponent: AuthError,
  component: SignInPage,
});
