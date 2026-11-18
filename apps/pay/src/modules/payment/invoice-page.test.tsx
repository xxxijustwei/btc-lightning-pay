import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { INVOICE, ORDER_ID, json, order, stubFetch } from "../../test/fixtures";
import { InvoicePage } from "./invoice-page";

function renderPage(newInvoiceHref?: string) {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <InvoicePage orderId={ORDER_ID} newInvoiceHref={newInvoiceHref} />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("InvoicePage", () => {
  it("shows the invoice and switches to success only when the backend reports paid", async () => {
    const responses = [order("pending"), order("paid")];
    stubFetch({
      [`GET /api/public/orders/${ORDER_ID}`]: () => json(responses.shift() ?? order("paid")),
    });
    const queryClient = renderPage();

    expect(await screen.findByText("Awaiting payment")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pay with Cash App →" }).getAttribute("href")).toBe(
      `https://cash.app/launch/lightning/${INVOICE}`,
    );
    expect(await screen.findByRole("img", { name: "Lightning invoice QR code" })).toBeTruthy();
    expect(screen.queryByText("Payment received")).toBeNull();

    await act(() => queryClient.refetchQueries());
    expect(await screen.findByRole("heading", { name: "Payment received" })).toBeTruthy();
  });

  it("keeps the invoice on screen and says it is reconnecting when a refresh fails", async () => {
    let first = true;
    stubFetch({
      [`GET /api/public/orders/${ORDER_ID}`]: () => {
        if (first) {
          first = false;
          return json(order("pending"));
        }
        throw new TypeError("Failed to fetch");
      },
    });
    const queryClient = renderPage();

    expect(await screen.findByText("Awaiting payment")).toBeTruthy();
    await act(() => queryClient.refetchQueries());
    expect(await screen.findByText(/Reconnecting/)).toBeTruthy();
    expect(screen.getByText("Awaiting payment")).toBeTruthy();
  });

  it("offers a new invoice from the original merchant link once expired", async () => {
    stubFetch({ [`GET /api/public/orders/${ORDER_ID}`]: () => json(order("expired")) });
    renderPage("/onne");
    expect(await screen.findByRole("heading", { name: "This invoice has expired" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Get a new invoice" }).getAttribute("href")).toBe(
      "/onne",
    );
  });

  it("shows not found for an unknown order", async () => {
    stubFetch({
      [`GET /api/public/orders/${ORDER_ID}`]: () =>
        json({ code: "ORDER_NOT_FOUND", message: "Not found" }, 404),
    });
    renderPage();
    expect(await screen.findByRole("heading", { name: "Payment link not found" })).toBeTruthy();
  });
});
