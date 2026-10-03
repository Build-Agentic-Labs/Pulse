import { describe, expect, it, vi } from "vitest";
import { listAwiMasters } from "./store";

function clientFixture(failAt?: number) {
  const records = Array.from({ length: 1203 }, (_, index) => ({ id: `awi-${index}` }));
  const range = vi.fn(async (from: number, to: number) => from === failAt
    ? { data: null, error: { message: "Connection lost" } }
    : { data: records.slice(from, to + 1), error: null });
  const order = vi.fn().mockReturnThis();
  const eq = vi.fn().mockReturnThis();
  const select = vi.fn().mockReturnThis();
  const client = { from: vi.fn(() => ({ select, eq, order, range })) };
  return { client, range, order, eq, records };
}

describe("AWI master collection reads", () => {
  it("reads all records beyond the API cap under the original workspace filter", async () => {
    const { client, records, range, order, eq } = clientFixture();
    expect(await listAwiMasters("workspace-a", client as never)).toEqual(records);
    expect(range.mock.calls).toEqual([[0, 499], [500, 999], [1000, 1499]]);
    expect(eq.mock.calls).toEqual(Array(3).fill(["workspace_id", "workspace-a"]));
    expect(order.mock.calls).toEqual(Array.from({ length: 3 }, () => [["created_at", { ascending: false }], ["id"]]).flat());
  });

  it("rejects a failed later page instead of returning an incomplete list", async () => {
    const { client } = clientFixture(500);
    await expect(listAwiMasters("workspace-a", client as never)).rejects.toThrow("Connection lost");
  });
});
