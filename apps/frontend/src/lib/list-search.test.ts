import { describe, expect, it } from "vite-plus/test";
import { beijingRange, paginationUpdate } from "./list-search";

describe("list pagination state", () => {
  it("keeps the page when only the page changes", () => {
    const current = { pageIndex: 0, pageSize: 10 };
    expect(paginationUpdate(current, (state) => ({ ...state, pageIndex: 3 }))).toEqual({
      page: 3,
      size: 10,
    });
  });

  it("starts over from the first page when the page size changes", () => {
    const current = { pageIndex: 4, pageSize: 10 };
    expect(paginationUpdate(current, { pageIndex: 4, pageSize: 30 })).toEqual({
      page: 0,
      size: 30,
    });
  });

  it("falls back to 10 rows for an unsupported page size", () => {
    const current = { pageIndex: 0, pageSize: 10 };
    expect(paginationUpdate(current, { pageIndex: 0, pageSize: 25 }).size).toBe(10);
  });
});

describe("beijingRange", () => {
  it("sends a Beijing day range as UTC instants, with an exclusive end", () => {
    expect(beijingRange({ from: "2026-11-20", to: "2026-11-21" })).toEqual({
      from: "2026-11-19T16:00:00.000Z",
      to: "2026-11-21T16:00:00.000Z",
    });
  });

  it("leaves out an open end", () => {
    expect(beijingRange({ from: null, to: "2026-11-20" })).toEqual({
      from: undefined,
      to: "2026-11-20T16:00:00.000Z",
    });
  });
});
