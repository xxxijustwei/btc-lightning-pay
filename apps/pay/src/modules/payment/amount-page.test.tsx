import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { ORDER_ID, json, merchant, order, stubFetch } from "../../test/fixtures";
import { AmountPage } from "./amount-page";

function renderPage(onOrderCreated = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AmountPage slug="onne" onOrderCreated={onOrderCreated} />
    </QueryClientProvider>,
  );
  return onOrderCreated;
}

describe("AmountPage", () => {
  it("creates an order for the chosen preset and hands back the order id", async () => {
    const calls = stubFetch({
      "GET /api/public/merchants/onne": () => json(merchant()),
      "POST /api/public/merchants/onne/orders": () => json(order("pending")),
    });
    const user = userEvent.setup();
    const onOrderCreated = renderPage();

    expect(await screen.findByRole("button", { name: "Choose an amount" })).toHaveProperty(
      "disabled",
      true,
    );
    await user.click(screen.getByRole("button", { name: "$25" }));
    expect(screen.getByRole("button", { name: "$25" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Pay $25.00 →" }));

    await waitFor(() => expect(onOrderCreated).toHaveBeenCalledWith(ORDER_ID));
    const post = calls.find((call) => call.key.startsWith("POST"));
    expect(JSON.parse(String(post?.init?.body))).toEqual({ amountUsdCents: 2500 });
    expect(new Headers(post?.init?.headers).get("idempotency-key")).toMatch(
      /^[A-Za-z0-9_-]{16,128}$/,
    );
  });

  it("retries a failed submission with the same idempotency key", async () => {
    let attempts = 0;
    const calls = stubFetch({
      "GET /api/public/merchants/onne": () => json(merchant()),
      "POST /api/public/merchants/onne/orders": () =>
        ++attempts === 1
          ? json({ code: "QUOTE_UNAVAILABLE", message: "No quote" }, 503)
          : json(order("creating")),
    });
    const user = userEvent.setup();
    const onOrderCreated = renderPage();

    await user.click(await screen.findByRole("button", { name: "$50" }));
    await user.click(screen.getByRole("button", { name: "Pay $50.00 →" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "couldn't get a live BTC price",
    );

    await user.click(screen.getByRole("button", { name: "Pay $50.00 →" }));
    await waitFor(() => expect(onOrderCreated).toHaveBeenCalledWith(ORDER_ID));
    const keys = calls
      .filter((call) => call.key.startsWith("POST"))
      .map((call) => new Headers(call.init?.headers).get("idempotency-key"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("validates a custom amount before allowing payment", async () => {
    stubFetch({ "GET /api/public/merchants/onne": () => json(merchant()) });
    const user = userEvent.setup();
    renderPage();

    const input = await screen.findByLabelText("Custom amount in USD");
    await user.type(input, "5");
    expect(screen.getByRole("alert").textContent).toContain("$10.00 to $300.00");
    expect(screen.getByRole("button", { name: "Choose an amount" })).toHaveProperty(
      "disabled",
      true,
    );

    await user.clear(input);
    await user.type(input, "12.50");
    expect(screen.getByRole("button", { name: "Pay $12.50 →" })).toHaveProperty("disabled", false);
  });

  it("shows the paused screen for a disabled merchant", async () => {
    stubFetch({ "GET /api/public/merchants/onne": () => json(merchant(false)) });
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "This payment link is paused" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "$25" })).toBeNull();
  });

  it("shows not found for an unknown merchant link", async () => {
    stubFetch({
      "GET /api/public/merchants/onne": () =>
        json({ code: "MERCHANT_NOT_FOUND", message: "Not found" }, 404),
    });
    renderPage();
    expect(await screen.findByRole("heading", { name: "Payment link not found" })).toBeTruthy();
  });
});
