import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), prepare: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({
  requireApiUser: async () => ({ userId: "user-1", failure: null, supabase: { rpc: mocks.rpc } }),
  createApiRateLimiter: () => () => true,
}));
vi.mock("@/lib/sop/parse-document", () => ({ prepareSopUpload: mocks.prepare }));
import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});
afterEach(() => vi.unstubAllEnvs());

function request() {
  const form = new FormData();
  form.set("workspaceId", "org-a");
  return new Request("http://localhost/api/sops/extract", { method: "POST", body: form });
}

describe("SOP conversion authorization", () => {
  it.each([
    { data: false, error: null },
    { data: null, error: null },
    { data: true, error: { message: "lookup failed" } },
  ])("denies when the database cannot confirm edit access: %j", async (result) => {
    mocks.rpc.mockResolvedValue(result);
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(mocks.rpc).toHaveBeenCalledWith("has_org_tool_access", {
      target_workspace_id: "org-a",
      min_level: "edit",
    });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("continues to upload validation after authorized access", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "No file uploaded." });
  });
});
