import type { PaginationState } from "@tanstack/react-table";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { DataTable, DataTablePagination } from "./data-table";
import { createAppColumnHelper, useAppTable } from "./table-hook";

type Row = { id: string; amount: number };
const helper = createAppColumnHelper<Row>();
const columns = helper.columns([
  helper.accessor("id", { header: "编号", footer: "合计" }),
  helper.accessor("amount", { header: "金额", footer: () => "60" }),
]);
const rows: Row[] = [
  { id: "a", amount: 10 },
  { id: "b", amount: 20 },
  { id: "c", amount: 30 },
];

function Harness({
  pagination,
  onPaginationChange,
  rowCount,
  hasNext,
}: {
  pagination: PaginationState;
  onPaginationChange: (next: PaginationState) => void;
  rowCount?: number;
  hasNext?: boolean;
}) {
  const totalKnown = rowCount !== undefined;
  const table = useAppTable({
    columns,
    data: rows,
    getRowId: (row) => row.id,
    manualPagination: true,
    ...(totalKnown ? { rowCount } : { pageCount: pagination.pageIndex + (hasNext ? 2 : 1) }),
    state: { pagination },
    onPaginationChange: (updater) =>
      onPaginationChange(typeof updater === "function" ? updater(pagination) : updater),
    meta: { totalKnown },
  });
  return (
    <table.AppTable>
      <DataTable />
      <DataTablePagination />
    </table.AppTable>
  );
}

describe("DataTable", () => {
  it("renders rows and column footers", () => {
    render(
      <Harness
        pagination={{ pageIndex: 0, pageSize: 10 }}
        onPaginationChange={vi.fn()}
        rowCount={3}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "金额" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "20" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "合计" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "60" })).toBeTruthy();
  });
});

describe("DataTablePagination", () => {
  it("shows every page when the total is known", async () => {
    const onPaginationChange = vi.fn();
    render(
      <Harness
        pagination={{ pageIndex: 0, pageSize: 10 }}
        onPaginationChange={onPaginationChange}
        rowCount={37}
      />,
    );
    expect(screen.getByText("共 37 条 · 第 1 / 4 页")).toBeTruthy();
    expect(screen.getByRole("button", { name: "第 1 页" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("button", { name: "上一页" }).hasAttribute("disabled")).toBe(true);
    await userEvent.setup().click(screen.getByRole("button", { name: "第 3 页" }));
    expect(onPaginationChange).toHaveBeenCalledWith({ pageIndex: 2, pageSize: 10 });
  });

  it("trusts the next-page probe when the total is unknown", () => {
    const { rerender } = render(
      <Harness pagination={{ pageIndex: 1, pageSize: 10 }} onPaginationChange={vi.fn()} hasNext />,
    );
    expect(screen.getByText("第 2 页")).toBeTruthy();
    expect(screen.getByRole("button", { name: "下一页" }).hasAttribute("disabled")).toBe(false);
    rerender(
      <Harness
        pagination={{ pageIndex: 1, pageSize: 10 }}
        onPaginationChange={vi.fn()}
        hasNext={false}
      />,
    );
    expect(screen.getByRole("button", { name: "下一页" }).hasAttribute("disabled")).toBe(true);
  });
});
