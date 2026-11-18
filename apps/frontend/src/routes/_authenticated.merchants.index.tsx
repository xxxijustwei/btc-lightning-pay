import { createFileRoute } from "@tanstack/react-router";
import { merchantsSearch, searchSchema } from "../lib/list-search";
import { MerchantsPage } from "../modules/admin/merchants-page";

export const Route = createFileRoute("/_authenticated/merchants/")({
  head: () => ({ meta: [{ title: "商户 · 平台管理" }] }),
  validateSearch: searchSchema(merchantsSearch),
  component: MerchantsPage,
});
