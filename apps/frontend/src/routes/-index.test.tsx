import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vite-plus/test";
import { Home } from "../pages/home";
import { UIProvider } from "../providers/ui";

test("health check runs on demand, reports failure and supports retry", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ error: "unavailable" }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ status: "ok" }));
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <UIProvider>
        <Home />
      </UIProvider>
    </QueryClientProvider>,
  );
  expect(fetchMock).not.toHaveBeenCalled();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "检查连接" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("连接失败"));
  await user.click(screen.getByRole("button", { name: "检查连接" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("后端连接正常"));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(client.getQueryData(["health"])).toEqual({ status: "ok" });
  client.clear();
});

test("a successful HTTP response with an invalid contract is still a failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "unexpected" })));
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <UIProvider>
        <Home />
      </UIProvider>
    </QueryClientProvider>,
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "检查连接" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("连接失败"));
  client.clear();
});

test("the Lobe button prevents duplicate requests while loading", async () => {
  let complete!: (response: Response) => void;
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <UIProvider>
        <Home />
      </UIProvider>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "检查连接" }));
  const pendingButton = await screen.findByRole("button", { name: "检查中…" });
  expect(pendingButton.hasAttribute("disabled")).toBe(true);
  await user.click(pendingButton);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  complete(Response.json({ status: "ok" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("后端连接正常"));
  client.clear();
});
