import { afterEach, describe, expect, it, vi } from "vitest";
import type { IeSmartAllocationRequest } from "@/domain/ie-smart-allocation";
import { requestIeSmartAllocationPlan } from "./smart-allocation-client";
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/domain/supabase-planner", () => ({ createPlannerSupabaseClient: () => ({ auth: { getSession } }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const request = { tasks: [] } as unknown as IeSmartAllocationRequest;
describe("smart allocation request boundary", () => {
  it("does not send a request without a signed-in session", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(requestIeSmartAllocationPlan(request)).rejects.toThrow("Sign in before running smart allocation.");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("sends the unchanged request to the same-origin endpoint and returns the plan", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "test-token" } } });
    const plan = { allocations: [] };
    const fetch = vi.fn().mockResolvedValue(Response.json({ plan })); vi.stubGlobal("fetch", fetch);
    await expect(requestIeSmartAllocationPlan(request)).resolves.toEqual(plan);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/smart-allocation", {
      method: "POST", headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" }, body: JSON.stringify(request),
    });
  });
  it("preserves server error feedback", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "test-token" } } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Allocation unavailable" }, { status: 503 })));
    await expect(requestIeSmartAllocationPlan(request)).rejects.toThrow("Allocation unavailable");
  });
  it("rejects a successful response without a plan", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "test-token" } } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
    await expect(requestIeSmartAllocationPlan(request)).rejects.toThrow("Smart allocation agent did not return a plan.");
  });
});
