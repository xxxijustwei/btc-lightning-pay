import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import { expect, test, vi } from "vite-plus/test";
import { DataTable, DataTablePagination } from "../../components/data-table/data-table";
import { createAppColumnHelper } from "../../components/data-table/table-hook";
import { ordersSearch } from "../../lib/list-search";
import { orderStatusOptions } from "./common";
import { FilterToggle } from "./filter-toggle";
import { useServerList } from "./server-list";

type Row = { id: string };
const helper = createAppColumnHelper<Row>();
const columns = helper.columns([helper.accessor("id", { header: "编号" })]);
const rows = (count: number, from = 0) =>
  Array.from({ length: count }, (_, index) => ({ id: `row-${from + index + 1}` }));

type FetchPage = (
  page: { limit: number; offset: number },
  filters: { status: string | null },
) => Promise<readonly Row[] | { items: readonly Row[]; total: number }>;

function List({ count, fetchPage }: { count: "probe" | "total"; fetchPage: FetchPage }) {
  const { table, list, search, setFilter } = useServerList({
    search: ordersSearch,
    key: "test",
    count,
    // The harness switches `count` at runtime, so the page shape is checked by the tests instead.
    fetchPage: ((page: { limit: number; offset: number }, filters: { status: string | null }) =>
      fetchPage(page, filters)) as never,
    columns,
    getRowId: (row: Row) => row.id,
    emptyMessage: "没有数据。",
  });
  return (
    <table.AppTable>
      <FilterToggle
        label="支付状态"
        options={orderStatusOptions}
        value={search.status}
        onChange={(status) => setFilter({ status })}
      />
      <DataTable loading={list.isPending} />
      <DataTablePagination />
    </table.AppTable>
  );
}

function mount(count: "probe" | "total", fetchPage: FetchPage, searchParams = "") {
  const urls: URLSearchParams[] = [];
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NuqsTestingAdapter
        hasMemory
        searchParams={searchParams}
        onUrlUpdate={(event: UrlUpdateEvent) => urls.push(event.searchParams)}
      >
        <List count={count} fetchPage={fetchPage} />
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  );
  return { urls, user: userEvent.setup() };
}
const nextButton = () => screen.getByRole("button", { name: "下一页" });

test("without a total, one extra row is requested to learn whether a next page exists", async () => {
  const fetchPage = vi.fn<FetchPage>(async ({ offset }) => (offset === 0 ? rows(11) : rows(4, 10)));
  const { user } = mount("probe", fetchPage);

  expect(await screen.findByRole("cell", { name: "row-10" })).toBeTruthy();
  expect(fetchPage).toHaveBeenLastCalledWith({ limit: 11, offset: 0 }, expect.anything());
  // The probe row is not shown, the footer gives no total, and a next page is offered.
  expect(screen.queryByRole("cell", { name: "row-11" })).toBeNull();
  expect(screen.getByText("第 1 页")).toBeTruthy();
  expect(nextButton().hasAttribute("disabled")).toBe(false);

  await user.click(nextButton());
  expect(await screen.findByRole("cell", { name: "row-14" })).toBeTruthy();
  expect(fetchPage).toHaveBeenLastCalledWith({ limit: 11, offset: 10 }, expect.anything());
  expect(nextButton().hasAttribute("disabled")).toBe(true);
});

test("with a total, the page is requested as is and the footer counts every row", async () => {
  const fetchPage = vi.fn<FetchPage>(async () => ({ items: rows(10), total: 37 }));
  mount("total", fetchPage);
  expect(await screen.findByText("共 37 条 · 第 1 / 4 页")).toBeTruthy();
  expect(fetchPage).toHaveBeenLastCalledWith({ limit: 10, offset: 0 }, expect.anything());
});

test("a filter change returns to the first page and 'all' removes the filter", async () => {
  const fetchPage = vi.fn<FetchPage>(async () => ({ items: rows(10), total: 37 }));
  const { urls, user } = mount("total", fetchPage, "?page=3&status=paid");
  expect(await screen.findByText("共 37 条 · 第 3 / 4 页")).toBeTruthy();
  expect(fetchPage).toHaveBeenLastCalledWith(
    { limit: 10, offset: 20 },
    { status: "paid", merchantId: null, from: null, to: null },
  );

  await user.click(screen.getByRole("button", { name: "已过期" }));
  await waitFor(() =>
    expect(fetchPage).toHaveBeenLastCalledWith(
      { limit: 10, offset: 0 },
      expect.objectContaining({ status: "expired" }),
    ),
  );
  expect(urls.at(-1)?.get("page")).toBeNull();
  expect(urls.at(-1)?.get("status")).toBe("expired");

  await user.click(screen.getByRole("button", { name: "全部" }));
  await waitFor(() => expect(urls.at(-1)?.get("status")).toBeNull());
});

test("a new page size starts over from the first page", async () => {
  const fetchPage = vi.fn<FetchPage>(async () => ({ items: rows(10), total: 95 }));
  const { urls, user } = mount("total", fetchPage, "?page=4");
  expect(await screen.findByText("共 95 条 · 第 4 / 10 页")).toBeTruthy();

  await user.click(screen.getByRole("combobox", { name: "每页行数" }));
  await user.click(await screen.findByRole("option", { name: "20" }));
  await waitFor(() =>
    expect(fetchPage).toHaveBeenLastCalledWith({ limit: 20, offset: 0 }, expect.anything()),
  );
  expect(urls.at(-1)?.get("size")).toBe("20");
  expect(urls.at(-1)?.get("page")).toBeNull();
});
