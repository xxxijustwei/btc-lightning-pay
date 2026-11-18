import { describe, expect, it } from "vite-plus/test";
import { paginationState, paginationUpdate } from "./list-search";

describe("list pagination state", () => {
  it("maps the 0-based page index to table state", () => {
    expect(paginationState({ page: 2, size: 20 })).toEqual({ pageIndex: 2, pageSize: 20 });
  });

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
