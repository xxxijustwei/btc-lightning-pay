import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { ORDER_ID, json, merchant, order, stubFetch } from "../../test/fixtures";
import { orderQueryKey } from "../../lib/public-api";
import { AmountPage } from "./amount-page";

let queryClient: QueryClient;

function renderPage(onOrderCreated = vi.fn()) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
    // The invoice page reads this instead of fetching the order again.
    expect(queryClient.getQueryData(orderQueryKey(ORDER_ID))).toMatchObject({ status: "pending" });
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
          : json(order("pending")),
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

  it("shows the wallet card and amount placeholders while the merchant loads", async () => {
    let release: (response: Response) => void = () => {};
    stubFetch({
      "GET /api/public/merchants/onne": () =>
        new Promise<Response>((resolve) => (release = resolve)),
    });
    renderPage();

    const loading = screen.getByRole("status", { name: "Loading amounts" });
    expect(loading.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(14);
    expect(screen.getByText("Cash App")).toBeTruthy();
    release(json(merchant()));
    expect(await screen.findByRole("button", { name: "Choose an amount" })).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Loading amounts" })).toBeNull();
  });

  it("stays on the amount page when the invoice can't be created", async () => {
    stubFetch({
      "GET /api/public/merchants/onne": () => json(merchant()),
      "POST /api/public/merchants/onne/orders": () =>
        json({ code: "WALLET_UNAVAILABLE", message: "Wallet unavailable" }, 503),
    });
    const user = userEvent.setup();
    const onOrderCreated = renderPage();

    await user.click(await screen.findByRole("button", { name: "$50" }));
    await user.click(screen.getByRole("button", { name: "Pay $50.00 →" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't create the invoice. Please try again.",
    );
    expect(onOrderCreated).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pay $50.00 →" })).toHaveProperty("disabled", false);
  });

  it("validates a custom amount before allowing payment", async () => {
    stubFetch({ "GET /api/public/merchants/onne": () => json(merchant()) });
    const user = userEvent.setup();
    renderPage();

    const input = await screen.findByLabelText("Custom amount in USD");
    await user.type(input, "0.99");
    expect(screen.getByRole("alert").textContent).toContain("$1.00 to $300.00");
    expect(screen.getByRole("button", { name: "Choose an amount" })).toHaveProperty(
      "disabled",
      true,
    );

    await user.clear(input);
    await user.type(input, "1");
    expect(screen.getByRole("button", { name: "Pay $1.00 →" })).toHaveProperty("disabled", false);
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
