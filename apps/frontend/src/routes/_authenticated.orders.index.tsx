import { createFileRoute } from "@tanstack/react-router";
import { OrdersPage } from "../modules/admin/orders-page";
import { merchantFilterSearch } from "../lib/search";

export const Route = createFileRoute("/_authenticated/orders/")({
  head: () => ({ meta: [{ title: "订单 · 平台管理" }] }),
  validateSearch: merchantFilterSearch,
  component: function OrdersRoute() {
    const { merchantId } = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <OrdersPage
        merchantId={merchantId}
        onMerchantChange={(next) =>
          void navigate({ search: next ? { merchantId: next } : {}, replace: true })
        }
      />
    );
  },
});
