import { createFileRoute, notFound } from "@tanstack/react-router";
import { AmountPage, merchantQueryOptions } from "../modules/payment/amount-page";
import { isMerchantSlug } from "../lib/slug";

export const Route = createFileRoute("/$slug")({
  beforeLoad: ({ params }) => {
    if (!isMerchantSlug(params.slug)) throw notFound();
  },
  // The first page arrives with the merchant; a failure is left for the page to show and retry.
  loader: ({ context, params }) =>
    context.queryClient.prefetchQuery({ ...merchantQueryOptions(params.slug), retry: false }),
  component: MerchantPayment,
});

function MerchantPayment() {
  const { slug } = Route.useParams();
  const navigate = Route.useNavigate();
  return (
    <AmountPage
      slug={slug}
      onOrderCreated={(orderId) =>
        void navigate({ to: "/invoice/$orderId", params: { orderId }, search: { m: slug } })
      }
    />
  );
}
