import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { OrderSettlementBadge } from "./common";

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
