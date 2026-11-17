import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vite-plus/test";
import { InvoiceDemo } from "./invoice-demo";

const invoice = { amountSat: 1000, paymentHash: "a".repeat(64), serialized: "lnbc10u1testinvoice" };
function renderDemo() {
  const client = new QueryClient({ defaultOptions: { mutations: { gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <InvoiceDemo />
    </QueryClientProvider>,
  );
  return client;
}

test("create needs no session, prevents duplicate submits, displays QR and copies BOLT11", async () => {
  let complete!: (response: Response) => void;
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  const client = renderDemo();
  expect(fetchMock).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "创建 Invoice" }));
  const pending = screen.getByRole("button", { name: "创建中…" });
  expect(pending.hasAttribute("disabled")).toBe(true);
  await user.click(pending);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  complete(Response.json(invoice));
  expect(await screen.findByRole("img", { name: "闪电网络 Invoice 二维码" })).toBeTruthy();
  expect(
    (screen.getByRole("textbox", { name: "BOLT11 Invoice" }) as HTMLTextAreaElement).value,
  ).toBe(invoice.serialized);
  await user.click(screen.getByRole("button", { name: "复制 Invoice" }));
  expect(await navigator.clipboard.readText()).toBe(invoice.serialized);
  expect(await screen.findByText("已复制")).toBeTruthy();
  client.clear();
});

test("failure leaves a manual retry and rejects malformed successful responses", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ...invoice, serialized: "invalid" }))
    .mockResolvedValueOnce(Response.json(invoice));
  vi.stubGlobal("fetch", fetchMock);
  const client = renderDemo();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "创建 Invoice" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "创建 Invoice" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("无效"));
  expect(screen.queryByRole("img")).toBeNull();
  await user.click(screen.getByRole("button", { name: "创建 Invoice" }));
  expect(await screen.findByRole("img")).toBeTruthy();
  client.clear();
});
