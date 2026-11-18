import { createFileRoute } from "@tanstack/react-router";
import { MerchantDetailPage } from "../modules/admin/merchant-detail-page";

export const Route = createFileRoute("/_authenticated/merchants/$merchantId")({
  head: () => ({ meta: [{ title: "商户详情 · 平台管理" }] }),
  component: function MerchantDetailRoute() {
    const { merchantId } = Route.useParams();
    return <MerchantDetailPage key={merchantId} merchantId={merchantId} />;
  },
});
