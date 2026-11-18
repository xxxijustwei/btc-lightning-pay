import { createFileRoute } from "@tanstack/react-router";
import { searchSchema, settlementsSearch } from "../lib/list-search";
import { SettlementsPage } from "../modules/admin/settlements-page";

export const Route = createFileRoute("/_authenticated/settlements/")({
  head: () => ({ meta: [{ title: "结算单 · 平台管理" }] }),
  validateSearch: searchSchema(settlementsSearch),
  component: SettlementsPage,
});
