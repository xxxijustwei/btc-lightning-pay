import { createFileRoute } from "@tanstack/react-router";
import { ordersSearch, searchSchema } from "../lib/list-search";
import { OrdersPage } from "../modules/admin/orders-page";

export const Route = createFileRoute("/_authenticated/orders/")({
  head: () => ({ meta: [{ title: "订单 · 平台管理" }] }),
  validateSearch: searchSchema(ordersSearch),
  component: OrdersPage,
});
