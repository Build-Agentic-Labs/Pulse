import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), auth: vi.fn(), overview: vi.fn(), createClient: vi.fn(() => ({})) }));
vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.auth, createApiRateLimiter: () => () => true }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/notifications/admin-overview", () => ({ loadAdminOverview: mocks.overview, resetLedgerRow: vi.fn() }));
import { GET, POST } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  mocks.auth.mockResolvedValue({ failure: null, userId: "user", supabase: { rpc: mocks.rpc } });
});
afterEach(() => vi.unstubAllEnvs());
it("rejects non-superadmins for reads and actions before accessing privileged data", async () => {
  mocks.rpc.mockResolvedValue({ data: false, error: null });
  expect((await GET(new Request("https://example.com/api/notifications/admin?workspaceId=ws"))).status).toBe(403);
  expect((await POST(new Request("https://example.com/api/notifications/admin", { method: "POST", body: JSON.stringify({ workspaceId: "ws", action: "resend", ledger: "sop_notifications", id: 1 }) }))).status).toBe(403);
  expect(mocks.rpc).toHaveBeenCalledWith("is_super_admin");
  expect(mocks.createClient).not.toHaveBeenCalled();
  expect(mocks.overview).not.toHaveBeenCalled();
});
it("allows a platform superadmin to read diagnostics", async () => {
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.overview.mockResolvedValue({ health: { healthy: true } });
  const response = await GET(new Request("https://example.com/api/notifications/admin?workspaceId=ws"));
  expect(response.status).toBe(200);
  expect(mocks.overview).toHaveBeenCalledWith(expect.anything(), "ws", expect.any(Date));
});
it("preserves authentication failures", async () => {
  mocks.auth.mockResolvedValue({ failure: new Response(null, { status: 401 }) });
  expect((await GET(new Request("https://example.com/api/notifications/admin?workspaceId=ws"))).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("fails closed when the superadmin lookup fails", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "lookup failed" } });
  expect((await GET(new Request("https://example.com/api/notifications/admin?workspaceId=ws"))).status).toBe(500);
  expect(mocks.createClient).not.toHaveBeenCalled();
});
