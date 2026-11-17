import { createFileRoute } from "@tanstack/react-router";
import { InvoiceDemo } from "../pages/invoice-demo";

export const Route = createFileRoute("/demo")({ component: InvoiceDemo });
