import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle } from "@btc-lightning-pay/ui/components/alert";
import { authQueryOptions } from "../lib/auth/queries";
import { AdminShell } from "../modules/admin/shell";
import { AuthError } from "../modules/auth/auth-error";
import { AccountMenu } from "../modules/auth/account-menu";

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
  // The backend also refuses non-admins; this only explains why nothing is shown.
  if (user.role !== "admin") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-6">
        <Alert>
          <AlertTitle>当前账号没有管理权限</AlertTitle>
          <AlertDescription>平台管理端仅限管理员使用。</AlertDescription>
        </Alert>
        <AccountMenu user={user} />
      </main>
    );
  }
  return (
    <AdminShell user={user}>
      <Outlet />
    </AdminShell>
  );
}
