import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), readiness: vi.fn(), list: vi.fn(), start: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.auth, createApiRateLimiter: () => () => true }));
vi.mock("@/lib/backup/local", () => ({ backupReadiness: mocks.readiness, listBackups: mocks.list, startBackup: mocks.start, readBackup: mocks.read, localBackupRoot: () => "/unused" }));
import { GET, POST } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ failure: null, userId: "admin", supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: true }); mocks.list.mockResolvedValue([]);
  mocks.readiness.mockResolvedValue({ ready: false, problems: ["Read-only setup required"] });
});
describe("backup export gate", () => {
  it("blocks non-super-admins before reading local files", async () => {
    mocks.rpc.mockResolvedValue({ data: false });
    expect((await GET(new Request("http://localhost:3000/api/backups"))).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.readiness).not.toHaveBeenCalled();
  });
  it("cannot start until the read-only and restore gates pass", async () => {
    const response = await POST(new Request("http://localhost:3000/api/backups", { method: "POST", headers: { origin: "http://localhost:3000" }, body: JSON.stringify({ password: "fixture-only-password" }) }));
    expect(response.status).toBe(503); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("rejects cross-origin starts and non-local hosts", async () => {
    expect((await POST(new Request("http://localhost:3000/api/backups", { method: "POST", headers: { origin: "https://other.example" } }))).status).toBe(403);
    expect((await GET(new Request("https://pulse.example/api/backups"))).status).toBe(403);
    expect(mocks.start).not.toHaveBeenCalled();
  });
});

it("rejects a null JSON body without starting a backup", async () => {
 mocks.readiness.mockResolvedValue({ready:true,problems:[]});
 const response=await POST(new Request("http://localhost:3000/api/backups",{method:"POST",headers:{origin:"http://localhost:3000"},body:"null"}));
 expect(response.status).toBe(400);expect(mocks.start).not.toHaveBeenCalled();
});
it("reports an unavailable archive without exposing a filesystem error", async () => {
 const id="11111111-1111-4111-8111-111111111111";
 mocks.read.mockResolvedValue({id,state:"complete",integrityVerified:true});
 const response=await GET(new Request(`http://localhost:3000/api/backups?download=${id}`));
 expect(response.status).toBe(404);expect(await response.json()).toEqual({error:"The local archive is unavailable. No files were changed."});
});
