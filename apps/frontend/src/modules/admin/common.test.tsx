import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { ListPagination, OrderSettlementBadge } from "./common";

describe("ListPagination", () => {
  it("shows every page when the API returns a total", async () => {
    const onPageChange = vi.fn();
    render(
      <ListPagination
        page={1}
        pageSize={10}
        total={37}
        onPageChange={onPageChange}
        onPageSizeChange={vi.fn()}
      />,
    );
    expect(screen.getByText("共 37 条 · 第 1 / 4 页")).toBeTruthy();
    expect(screen.getByRole("button", { name: "第 1 页" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("button", { name: "上一页" }).hasAttribute("disabled")).toBe(true);
    await userEvent.setup().click(screen.getByRole("button", { name: "第 3 页" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("relies on hasNext when the API returns no total", () => {
    const { rerender } = render(
      <ListPagination
        page={2}
        pageSize={10}
        hasNext
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    );
    expect(screen.getByText("第 2 页")).toBeTruthy();
    expect(screen.getByRole("button", { name: "下一页" }).hasAttribute("disabled")).toBe(false);
    rerender(
      <ListPagination
        page={2}
        pageSize={10}
        hasNext={false}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "下一页" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("OrderSettlementBadge", () => {
  it("never shows an occupied order as settled", () => {
    const { rerender } = render(<OrderSettlementBadge status="pending" paid />);
    expect(screen.getByText("结算中")).toBeTruthy();
    expect(screen.queryByText("已结算")).toBeNull();
    rerender(<OrderSettlementBadge status={null} paid />);
    expect(screen.getByText("未结算")).toBeTruthy();
    rerender(<OrderSettlementBadge status={null} paid={false} />);
    expect(screen.getByText("—")).toBeTruthy();
  });
});
