import { createFileRoute } from "@tanstack/react-router";
import { UnavailableScreen } from "../modules/payment/unavailable-screen";

// Payers only arrive through a merchant link; the bare domain has nothing to pay.
export const Route = createFileRoute("/")({
  component: () => <UnavailableScreen variant="notfound" />,
});
