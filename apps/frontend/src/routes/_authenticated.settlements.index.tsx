import { createFileRoute } from "@tanstack/react-router";
import { SettlementsPage } from "../modules/admin/settlements-page";
import { merchantFilterSearch } from "../lib/search";

export const Route = createFileRoute("/_authenticated/settlements/")({
  head: () => ({ meta: [{ title: "结算单 · 平台管理" }] }),
  validateSearch: merchantFilterSearch,
  component: function SettlementsRoute() {
    const { merchantId } = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <SettlementsPage
        merchantId={merchantId}
        onMerchantChange={(next) =>
          void navigate({ search: next ? { merchantId: next } : {}, replace: true })
        }
      />
    );
  },
});
