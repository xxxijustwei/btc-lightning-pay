import { createFileRoute, notFound } from "@tanstack/react-router";
import { InvoicePage } from "../modules/payment/invoice-page";
import { isMerchantSlug, isOrderId } from "../lib/slug";

export const Route = createFileRoute("/invoice/$orderId")({
  // `m` remembers which merchant link the payer came from, so an expired invoice can start over.
  validateSearch: (search: Record<string, unknown>): { m?: string } => ({
    m: isMerchantSlug(search.m) ? search.m : undefined,
  }),
  beforeLoad: ({ params }) => {
    if (!isOrderId(params.orderId)) throw notFound();
  },
  component: Invoice,
});

function Invoice() {
  const { orderId } = Route.useParams();
  const { m } = Route.useSearch();
  return <InvoicePage orderId={orderId} merchantSlug={m} />;
}
