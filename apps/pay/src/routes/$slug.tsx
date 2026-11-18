import { createFileRoute, notFound } from "@tanstack/react-router";
import { AmountPage } from "../modules/payment/amount-page";
import { isMerchantSlug } from "../lib/slug";

export const Route = createFileRoute("/$slug")({
  beforeLoad: ({ params }) => {
    if (!isMerchantSlug(params.slug)) throw notFound();
  },
  component: MerchantPayment,
});

function MerchantPayment() {
  const { slug } = Route.useParams();
  const navigate = Route.useNavigate();
  return (
    <AmountPage
      slug={slug}
      onOrderCreated={(orderId) =>
        void navigate({ to: "/pay/invoice/$orderId", params: { orderId }, search: { m: slug } })
      }
    />
  );
}
