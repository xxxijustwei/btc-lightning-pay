import { createFileRoute } from "@tanstack/react-router";
import { accountsSearch, searchSchema } from "../lib/list-search";
import { AccountsPage } from "../modules/admin/accounts-page";

export const Route = createFileRoute("/_authenticated/accounts")({
  head: () => ({ meta: [{ title: "账号 · 平台管理" }] }),
  validateSearch: searchSchema(accountsSearch),
  component: function AccountsRoute() {
    const { user } = Route.useRouteContext();
    return <AccountsPage currentUserId={user.id} />;
  },
});
