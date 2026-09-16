import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  prepare: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/api-auth", () => ({
  requireApiUser: async () => ({
    userId: "user-1",
    failure: null,
    supabase: {
      rpc: mocks.rpc,
      storage: { from: () => ({ download: mocks.download, remove: mocks.remove }) },
    },
  }),
  createApiRateLimiter: () => () => true,
}));
vi.mock("@/lib/sop/parse-document", () => ({ prepareSopUpload: mocks.prepare }));
import { POST } from "./route";

const OWN_PATH = "users/user-1/org-a/u1-legacy.docx";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  mocks.remove.mockResolvedValue({ data: null, error: null });
});
afterEach(() => vi.unstubAllEnvs());

function request(body: Record<string, unknown> = { workspaceId: "org-a" }) {
  return new Request("http://localhost/api/sops/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("continues to upload validation after authorized access", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "No file uploaded." });
  });
});

describe("SOP conversion source relay", () => {
  beforeEach(() => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });

  it("rejects a body that is not JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/sops/extract", { method: "POST", body: "not json" }),
    );
    expect(response.status).toBe(400);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it.each([
    { storagePath: "users/user-2/org-a/u1-legacy.docx", why: "another user's prefix" },
    { storagePath: "users/user-1/org-b/u1-legacy.docx", why: "a different workspace" },
  ])("refuses a path under $why without touching storage", async ({ storagePath }) => {
    const response = await POST(request({ workspaceId: "org-a", storagePath }));
    expect(response.status).toBe(400);
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("answers 404 when the source is missing from storage", async () => {
    mocks.download.mockResolvedValue({ data: null, error: { message: "Object not found" } });
    const response = await POST(request({ workspaceId: "org-a", storagePath: OWN_PATH }));
    expect(response.status).toBe(404);
    expect(mocks.download).toHaveBeenCalledWith(OWN_PATH);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("downloads the source as the caller, deletes it, and hands the file to the parser", async () => {
    mocks.download.mockResolvedValue({
      data: new Blob(["docx-bytes"], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      error: null,
    });
    mocks.prepare.mockRejectedValue(new Error("No readable content was found in the uploaded file."));

    const response = await POST(request({ workspaceId: "org-a", storagePath: OWN_PATH }));

    expect(mocks.remove).toHaveBeenCalledWith([OWN_PATH]);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    const file = mocks.prepare.mock.calls[0][0] as File;
    expect(file.name).toBe("u1-legacy.docx");
    expect(await file.text()).toBe("docx-bytes");
    // The parser's failure surfaces as the route's 422, proving the file reached it intact.
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "No readable content was found in the uploaded file." });
  });

  it("still converts when the cleanup delete fails", async () => {
    mocks.download.mockResolvedValue({ data: new Blob(["pdf"], { type: "application/pdf" }), error: null });
    mocks.remove.mockRejectedValue(new Error("storage hiccup"));
    mocks.prepare.mockRejectedValue(new Error("stop here"));

    const response = await POST(request({ workspaceId: "org-a", storagePath: "users/user-1/org-a/u2-scan.pdf" }));

    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(422);
  });
});
