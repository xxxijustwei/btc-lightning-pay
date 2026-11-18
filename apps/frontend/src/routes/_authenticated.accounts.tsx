import { createFileRoute } from "@tanstack/react-router";
import { AccountsPage } from "../modules/admin/accounts-page";

export const Route = createFileRoute("/_authenticated/accounts")({
  head: () => ({ meta: [{ title: "账号 · 平台管理" }] }),
  component: function AccountsRoute() {
    const { user } = Route.useRouteContext();
    return <AccountsPage currentUserId={user.id} />;
  },
});
