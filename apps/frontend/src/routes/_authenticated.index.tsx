import { createFileRoute } from "@tanstack/react-router";
import { OverviewPage } from "../modules/admin/overview-page";

export const Route = createFileRoute("/_authenticated/")({
  component: OverviewPage,
});
