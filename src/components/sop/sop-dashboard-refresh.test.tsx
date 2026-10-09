// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SopDashboard } from "./sop-dashboard";
import { listSops } from "@/lib/sop/store";
import { listDepartments } from "@/lib/departments/store";
import { SOP_DEMAND_UPDATED_EVENT } from "@/lib/sop/dashboard-events";
vi.mock("./sop-workspace-provider", () => ({ useSopWorkspace: () => ({ workspaceId: "ws" }) }));
vi.mock("@/lib/sop/store", () => ({ listSops: vi.fn(async () => []) }));
vi.mock("@/lib/departments/store", () => ({ listDepartments: vi.fn(async () => []) }));
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("keeps the visible cadence, skips hidden polling, and shares return events", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  render(<SopDashboard initialSops={[]} initialDepartments={[]} initialWorkspaceId="ws" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(listSops).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue("hidden");
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(listSops).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue("visible");
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(listSops).toHaveBeenCalledTimes(2);
  expect(listDepartments).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(listSops).toHaveBeenCalledTimes(3);
});

it("runs a fresh read after a target changes during an outstanding refresh", async () => {
  let resolve!: (value: []) => void;
  vi.mocked(listSops).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  render(<SopDashboard />);
  await act(async () => {});
  expect(listSops).toHaveBeenCalledTimes(1);
  act(() => { window.dispatchEvent(new Event(SOP_DEMAND_UPDATED_EVENT)); });
  expect(listSops).toHaveBeenCalledTimes(1);
  await act(async () => { resolve([]); });
  expect(listSops).toHaveBeenCalledTimes(2);
});
