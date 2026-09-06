import { describe, expect, it, vi } from "vitest";
import { readAllPages, readRowsByIds } from "./read-all-pages";

describe("bounded collection reads", () => {
  it("loads beyond the API row cap without dropping or duplicating records", async () => {
    const records = Array.from({ length: 1203 }, (_, id) => ({ id }));
    const fetch = vi.fn(async (from: number, to: number) => records.slice(from, to + 1));
    expect(await readAllPages(fetch)).toEqual(records);
    expect(fetch.mock.calls).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });
  it("does not return a partial editable graph after a later page fails", async () => {
    await expect(readAllPages(async (from) => {
      if (from) throw new Error("Connection lost");
      return Array.from({ length: 500 }, (_, id) => ({ id }));
    })).rejects.toThrow("Connection lost");
  });
  it("handles empty results and exact page boundaries", async () => {
    expect(await readAllPages(async () => [])).toEqual([]);
    expect(await readAllPages(async (from) => from ? [] : Array(500).fill(1))).toHaveLength(500);
  });
  it("bounds IN filters and pages every batch independently", async () => {
    const ids = Array.from({ length: 201 }, (_, id) => String(id));
    const fetch = vi.fn(async (batch: string[]) => batch.map((id) => ({ id })));
    expect(await readRowsByIds(ids, fetch)).toEqual(ids.map((id) => ({ id })));
    expect(fetch.mock.calls.map(([batch]) => batch.length)).toEqual([100, 100, 1]);
  });
});
