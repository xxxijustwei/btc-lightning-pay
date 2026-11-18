import { createFileRoute } from "@tanstack/react-router";
import { paginationParsers, searchSchema } from "../lib/list-search";
import { SettlementDetailPage } from "../modules/admin/settlement-detail-page";

export const Route = createFileRoute("/_authenticated/settlements/$settlementId")({
  head: () => ({ meta: [{ title: "结算单详情 · 平台管理" }] }),
  validateSearch: searchSchema(paginationParsers),
  component: function SettlementDetailRoute() {
    const { settlementId } = Route.useParams();
    return <SettlementDetailPage key={settlementId} settlementId={settlementId} />;
  },
});
