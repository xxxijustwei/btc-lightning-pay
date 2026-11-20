import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vite-plus/test";

// The server functions run in process, with the global `fetch` standing in for the backend binding.
vi.mock("../lib/public-api.functions", async () => {
  const { contractClient } = await import("../lib/contract-client");
  const { publicEndpoints, settle } = await import("../lib/public-calls");
  const backend = contractClient(publicEndpoints, (path, init) => fetch(path, init));
  type Data<Name extends keyof typeof backend> = { data: Parameters<(typeof backend)[Name]>[0] };
  return {
    merchantFn: vi.fn(({ data }: Data<"merchant">) => settle(() => backend.merchant(data))),
    createOrderFn: vi.fn(({ data }: Data<"createOrder">) =>
      settle(() => backend.createOrder(data)),
    ),
    orderFn: vi.fn(({ data }: Data<"order">) => settle(() => backend.order(data))),
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
