import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), workspace: vi.fn(), list: vi.fn(), actions: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/lib/supabase/request-context", () => ({ getServerAuthContext: mocks.auth }));
vi.mock("@/lib/supabase/server-data", () => ({ fetchInitialSopWorkspaceData: mocks.workspace }));
vi.mock("@/lib/problem-solving/store", () => ({ listCases: mocks.list, listActions: mocks.actions }));
vi.mock("@/components/problem-solving/problem-workspace", () => ({ ProblemWorkspace: () => null }));
import Page from "./page";
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "user" }, supabase: { rpc: mocks.rpc } }); mocks.workspace.mockResolvedValue({ workspaceId: "ws" }); mocks.list.mockResolvedValue([]); mocks.actions.mockResolvedValue([]); });
describe("private pilot route", () => {
  it("redirects a signed-out visitor", async () => { mocks.auth.mockResolvedValue({ user: null }); await expect(Page()).rejects.toThrow("redirect:/login"); expect(mocks.list).not.toHaveBeenCalled(); });
  it.each([{ data: false, error: null }, { data: true, error: { message: "unavailable" } }, { data: null, error: null }])("fails closed without a confirmed pilot grant", async result => { mocks.rpc.mockResolvedValue(result); await expect(Page()).rejects.toThrow("not-found"); expect(mocks.list).not.toHaveBeenCalled(); });
  it("prefetches data under the authorized user's client", async () => { mocks.rpc.mockResolvedValue({ data: true, error: null }); const page = await Page(); expect(page.props.initial.workspaceId).toBe("ws"); expect(mocks.list).toHaveBeenCalledWith("ws", { rpc: mocks.rpc }); });
});
