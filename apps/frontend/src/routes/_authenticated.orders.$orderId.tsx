import { createFileRoute } from "@tanstack/react-router";
import { OrderDetailPage } from "../modules/admin/order-detail-page";

export const Route = createFileRoute("/_authenticated/orders/$orderId")({
  head: () => ({ meta: [{ title: "订单详情 · 平台管理" }] }),
  component: function OrderDetailRoute() {
    const { orderId } = Route.useParams();
    return <OrderDetailPage key={orderId} orderId={orderId} />;
  },
});
