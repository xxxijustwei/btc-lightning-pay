import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { authQueryOptions } from "../lib/auth/queries";
import { AuthError } from "../modules/auth/auth-error";
import { AccountHeader } from "../modules/auth/account-header";

export const Route = createFileRoute("/_authenticated")({
  headers: () => ({ "cache-control": "private, no-store" }),
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.fetchQuery(authQueryOptions());
    if (!user) throw redirect({ to: "/sign-in", replace: true });
    return { user };
  },
  errorComponent: AuthError,
  component: AuthenticatedLayout,
});
function AuthenticatedLayout() {
  const { user } = Route.useRouteContext();
  return (
    <>
      <AccountHeader user={user} />
      <Outlet />
    </>
  );
}
