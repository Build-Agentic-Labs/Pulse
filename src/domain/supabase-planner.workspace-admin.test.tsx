// Characterization of the workspace administration functions Phase 5 moves into
// src/lib/planner/workspace-store.ts: organization/product edits, members, the per-member access
// matrix, invitations (domain check, revocation lift, expiry) and profile names. Real functions,
// recording client installed as the page's shared planner client.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecordingSupabase, type RecordedRequest, type ScriptedReply } from "@/test-support/recording-supabase";
import { SIGNUP_DOMAIN_MESSAGE } from "@/lib/allowed-signup-domain";
import {
  deleteProjectFromSupabase,
  deleteWorkspaceAccessGrantFromSupabase,
  loadMembersAccessForWorkspace,
  loadProfileNamesByIds,
  loadWorkspaceAccessGrantsFromSupabase,
  loadWorkspaceMembersFromSupabase,
  removeWorkspaceMemberInSupabase,
  updateOwnProfileNameInSupabase,
  updateProjectInSupabase,
  updateWorkspaceInSupabase,
  updateWorkspaceMemberRoleInSupabase,
  upsertWorkspaceAccessGrantInSupabase,
} from "./supabase-planner";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

const scope = globalThis as { __buildlogicPlannerSupabaseClient?: unknown };
function install(reply?: (request: RecordedRequest) => ScriptedReply | undefined, userId: string | null = "manager-1") {
  const db = createRecordingSupabase({ userId, reply });
  scope.__buildlogicPlannerSupabaseClient = db.client;
  return db;
}

beforeEach(() => { delete scope.__buildlogicPlannerSupabaseClient; });
afterEach(() => { delete scope.__buildlogicPlannerSupabaseClient; vi.useRealTimers(); });

describe("organization and product edits", () => {
  it("renames an organization with a trimmed name and refuses a blank one before any request", async () => {
    const db = install();
    await expect(updateWorkspaceInSupabase("ws-1", { name: "   " })).rejects.toThrow("Organization name is required.");
    await expect(updateWorkspaceInSupabase("ws-1", {})).rejects.toThrow("Organization name is required.");
    expect(db.requests).toEqual([]);
    await updateWorkspaceInSupabase("ws-1", { name: "  ANA Corp " });
    expect(db.lines()).toEqual(["workspaces.update id=ws-1"]);
    expect(db.requests[0]!.payload).toEqual({ name: "ANA Corp" });
  });

  it("maps a product patch to columns, confirms the row, and skips empty patches", async () => {
    const db = install((r) => (r.target === "projects" ? { data: { id: "proj-1" } } : undefined));
    await updateProjectInSupabase("proj-1", {});
    expect(db.requests).toEqual([]);
    await updateProjectInSupabase("proj-1", {
      name: " FlexBoost ", description: "  ", status: "active", portfolioCategory: null, portfolioPosition: 3,
    });
    await updateProjectInSupabase("proj-1", { description: " Notes " });
    expect(db.lines()).toEqual(["projects.update id=proj-1 | returning(id) single", "projects.update id=proj-1 | returning(id) single"]);
    expect(db.requests.map((r) => r.payload)).toEqual([
      { name: "FlexBoost", description: null, portfolio_position: 3, portfolio_category: null, status: "active" },
      { description: "Notes" },
    ]);
  });

  it("validates product names and positions before writing", async () => {
    const db = install();
    await expect(updateProjectInSupabase("p", { name: " " })).rejects.toThrow("Workspace name is required.");
    await expect(updateProjectInSupabase("p", { portfolioPosition: Number.NaN })).rejects.toThrow("Invalid product order.");
    expect(db.requests).toEqual([]);
  });

  it("deletes a product's planner products before the product itself, and stops on failure", async () => {
    const db = install();
    await deleteProjectFromSupabase("proj-1");
    expect(db.lines()).toEqual(["products.delete project_id=proj-1", "projects.delete id=proj-1"]);
    const failing = install((r) => (r.target === "products" ? { error: { message: "denied" } } : undefined));
    await expect(deleteProjectFromSupabase("proj-1")).rejects.toThrow("denied");
    expect(failing.lines()).toEqual(["products.delete project_id=proj-1"]);
  });

  it("resolves distinct, non-empty profile ids and drops empty or missing names", async () => {
    const db = install(() => ({ data: [{ id: "u1", full_name: "Pat" }, { id: "u2", full_name: "" }, { id: "u3", full_name: null }] }));
    expect(await loadProfileNamesByIds([])).toEqual(new Map());
    expect(await loadProfileNamesByIds(["", ""])).toEqual(new Map());
    expect(db.requests).toEqual([]);
    expect(await loadProfileNamesByIds(["u1", "u2", "u1", "", "u3"])).toEqual(new Map([["u1", "Pat"]]));
    expect(db.lines()).toEqual(["profiles.select(id,full_name) id in [u1,u2,u3]"]);
  });
});

describe("members and the access matrix", () => {
  const memberRows = [
    { workspace_id: "ws-1", user_id: "manager-1", role: "owner", created_at: "2026-01-01" },
    { workspace_id: "ws-1", user_id: "user-2", role: "editor", created_at: "2026-02-01" },
  ];
  const reply = (r: RecordedRequest): ScriptedReply | undefined => {
    if (r.target === "workspace_members") return { data: memberRows };
    if (r.target === "profiles") return { data: [{ id: "user-2", full_name: "Robin", avatar_url: null, email: "r@x" }] };
    if (r.target === "projects") return { data: [{ id: "p1" }, { id: "p2" }] };
    if (r.target === "project_access") return { data: [{ project_id: "p2", user_id: "user-2", level: "view" }] };
    if (r.target === "org_tool_access") return { data: [{ user_id: "manager-1", level: "edit" }] };
    return undefined;
  };

  it("merges members with their profiles (no embed) and skips the profile read when empty", async () => {
    const db = install(reply);
    const members = await loadWorkspaceMembersFromSupabase("ws-1", db.client as never);
    expect(db.lines()).toEqual([
      "workspace_members.select(workspace_id,user_id,role,created_at) workspace_id=ws-1 | order(created_at)",
      "profiles.select(id,full_name,avatar_url,email) id in [manager-1,user-2]",
    ]);
    expect(members).toEqual([
      { workspaceId: "ws-1", userId: "manager-1", role: "owner", createdAt: "2026-01-01", fullName: undefined, avatarUrl: undefined, email: undefined },
      { workspaceId: "ws-1", userId: "user-2", role: "editor", createdAt: "2026-02-01", fullName: "Robin", avatarUrl: undefined, email: "r@x" },
    ]);
    const empty = install(() => ({ data: [] }));
    expect(await loadWorkspaceMembersFromSupabase("ws-1")).toEqual([]);
    expect(empty.lines()).toEqual(["workspace_members.select(workspace_id,user_id,role,created_at) workspace_id=ws-1 | order(created_at)"]);
  });

  it("builds each member's project and Quality levels from rows scoped to this organization", async () => {
    const db = install(reply);
    const matrix = await loadMembersAccessForWorkspace("ws-1");
    expect(db.lines()).toEqual([
      "auth.getSession",
      "workspace_members.select(workspace_id,user_id,role,created_at) workspace_id=ws-1 | order(created_at)",
      "projects.select(id) workspace_id=ws-1 | order(created_at)",
      "profiles.select(id,full_name,avatar_url,email) id in [manager-1,user-2]",
      "project_access.select(project_id, user_id, level) project_id in [p1,p2]",
      "org_tool_access.select(user_id, level) workspace_id=ws-1 user_id in [manager-1,user-2]",
    ]);
    expect(matrix).toEqual([
      { userId: "manager-1", fullName: undefined, email: undefined, role: "owner", isSelf: true, joinedAt: "2026-01-01", projectLevels: { p1: "none", p2: "none" }, orgTools: "edit" },
      { userId: "user-2", fullName: "Robin", email: "r@x", role: "editor", isSelf: false, joinedAt: "2026-02-01", projectLevels: { p1: "none", p2: "view" }, orgTools: "none" },
    ]);
  });

  it("does not query grants for an organization without products or members", async () => {
    const db = install((r) => (r.target === "workspace_members" || r.target === "projects" ? { data: [] } : undefined));
    expect(await loadMembersAccessForWorkspace("ws-1")).toEqual([]);
    expect(db.lines().some((line) => line.startsWith("project_access") || line.startsWith("org_tool_access"))).toBe(false);
  });

  it("changes a role and reports a row RLS filtered out instead of pretending it landed", async () => {
    const db = install((r) => (r.target === "workspace_members" ? { data: [{ user_id: "user-2" }] } : undefined));
    await updateWorkspaceMemberRoleInSupabase("ws-1", "user-2", "admin");
    expect(db.lines()).toEqual(["workspace_members.update workspace_id=ws-1 user_id=user-2 | returning(user_id)"]);
    expect(db.requests[0]!.payload).toEqual({ role: "admin" });
    install(() => ({ data: [] }));
    await expect(updateWorkspaceMemberRoleInSupabase("ws-1", "owner-9", "viewer")).rejects.toThrow("You don't have permission to change this member's role.");
  });

  it("removes a member through the offboarding RPC, explaining a missing migration", async () => {
    const db = install();
    await removeWorkspaceMemberInSupabase("ws-1", "user-2");
    expect(db.requests).toMatchObject([{ kind: "rpc", target: "remove_workspace_member", payload: { target_workspace_id: "ws-1", target_user_id: "user-2" } }]);
    install(() => ({ error: { message: "missing", code: "PGRST202" } }));
    await expect(removeWorkspaceMemberInSupabase("ws-1", "u")).rejects.toThrow("Member removal requires the latest database migration. Apply migrations and retry.");
    install(() => ({ error: { message: "only owners", code: "42501" } }));
    await expect(removeWorkspaceMemberInSupabase("ws-1", "u")).rejects.toMatchObject({ message: "only owners" });
  });
});

describe("invitations", () => {
  const entitlements = {
    organizationRole: "member", qualityAccess: "view", accessPackage: "custom", planningAccess: "none",
    projectAccess: [{ projectId: "p1", level: "edit" }], departmentAccess: [],
  } as unknown as Parameters<typeof upsertWorkspaceAccessGrantInSupabase>[2];

  it("refuses an address outside the allowed domains before any request", async () => {
    const db = install();
    await expect(upsertWorkspaceAccessGrantInSupabase("ws-1", "someone@gmail.com", entitlements)).rejects.toThrow(SIGNUP_DOMAIN_MESSAGE);
    expect(db.requests).toEqual([]);
  });

  it("lifts a prior revocation, then upserts the normalized grant with a fresh 30-day window", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-03T12:00:00.000Z"), toFake: ["Date"] });
    const db = install();
    await upsertWorkspaceAccessGrantInSupabase("ws-1", "  Pat@AnaCorp.com ", entitlements);
    expect(db.lines()).toEqual([
      "auth.getSession",
      "workspace_revocations.delete workspace_id=ws-1 email=pat@anacorp.com",
      "workspace_access_grants.upsert",
    ]);
    const grant = db.requests[2]!;
    expect(grant.options).toEqual({ onConflict: "workspace_id,email" });
    expect(grant.payload).toMatchObject({
      workspace_id: "ws-1", email: "pat@anacorp.com", granted_by: "manager-1",
      project_access: [{ project_id: "p1", level: "edit" }], department_access: [],
      expires_at: "2026-11-02T12:00:00.000Z", redeemed_by: null, redeemed_at: null,
    });
  });

  it("tolerates a missing revocations table but not a refused revocation delete", async () => {
    const tolerant = install((r) => (r.target === "workspace_revocations" ? { error: { message: "missing", code: "42P01" } } : undefined));
    await upsertWorkspaceAccessGrantInSupabase("ws-1", "pat@anacorp.com", entitlements);
    expect(tolerant.lines().at(-1)).toBe("workspace_access_grants.upsert");
    const refused = install((r) => (r.target === "workspace_revocations" ? { error: { message: "denied", code: "42501" } } : undefined));
    await expect(upsertWorkspaceAccessGrantInSupabase("ws-1", "pat@anacorp.com", entitlements)).rejects.toMatchObject({ message: "denied" });
    expect(refused.lines().some((line) => line.startsWith("workspace_access_grants"))).toBe(false);
  });

  it("lists grants oldest first and deletes by normalized address", async () => {
    const db = install((r) => (r.op === "select" ? { data: [] } : undefined));
    await loadWorkspaceAccessGrantsFromSupabase("ws-1");
    await deleteWorkspaceAccessGrantFromSupabase("ws-1", " Pat@AnaCorp.com ");
    expect(db.lines()).toEqual([
      "workspace_access_grants.select(*) workspace_id=ws-1 | order(created_at)",
      "workspace_access_grants.delete workspace_id=ws-1 email=pat@anacorp.com",
    ]);
  });
});

describe("own display name", () => {
  it("requires a session and a valid name before writing", async () => {
    const signedOut = install(undefined, null);
    await expect(updateOwnProfileNameInSupabase("Pat Lee")).rejects.toThrow("Sign in first.");
    expect(signedOut.lines()).toEqual(["auth.getSession"]);
    const db = install();
    await expect(updateOwnProfileNameInSupabase("   ")).rejects.toThrow();
    expect(db.lines()).toEqual(["auth.getSession"]);
  });

  it("upserts the profile, then mirrors the name into auth metadata", async () => {
    const db = install((r) => (r.target === "profiles" ? { data: { id: "manager-1" } } : undefined));
    await updateOwnProfileNameInSupabase("  Pat   Lee ");
    expect(db.lines()).toEqual(["auth.getSession", "profiles.upsert | returning(id) maybeSingle", "auth.updateUser"]);
    const name = (db.requests[1]!.payload as { full_name: string }).full_name;
    expect(db.requests[1]).toMatchObject({ payload: { id: "manager-1" }, options: { onConflict: "id" } });
    expect(db.requests[2]!.payload).toEqual({ data: { full_name: name } });
  });

  it("stops when the profile write is not confirmed, and surfaces an auth failure", async () => {
    const unconfirmed = install(() => ({ data: null }));
    await expect(updateOwnProfileNameInSupabase("Pat Lee")).rejects.toThrow("Unable to update the display name.");
    expect(unconfirmed.lines().includes("auth.updateUser")).toBe(false);
    install((r) => (r.target === "profiles" ? { data: { id: "manager-1" } } : r.op === "updateUser" ? { error: { message: "auth down" } } : undefined));
    await expect(updateOwnProfileNameInSupabase("Pat Lee")).rejects.toMatchObject({ message: "auth down" });
  });
});

describe("membership bootstrap", () => {
  it("runs profile setup and invite redemption once per signed-in user per client", async () => {
    const { ensureDefaultWorkspaceMembership } = await import("./supabase-planner");
    let currentUser = { id: "user-a", email: "a@anacorp.com", user_metadata: {} };
    const db = createRecordingSupabase({ reply: (r) => (r.target === "is_super_admin" ? { data: false } : undefined) });
    const tab = { ...db.client, auth: { ...db.client.auth, getSession: async () => ({ data: { session: { user: currentUser } }, error: null }) } };
    const bootstraps = () => db.lines().filter((line) => line === "profiles.upsert" || line === "rpc:redeem_workspace_access_grants").length;

    await ensureDefaultWorkspaceMembership(tab as never);
    expect(bootstraps()).toBe(2);
    await ensureDefaultWorkspaceMembership(tab as never);
    expect(bootstraps()).toBe(2);
    currentUser = { id: "user-b", email: "b@anacorp.com", user_metadata: {} };
    await ensureDefaultWorkspaceMembership(tab as never);
    expect(bootstraps()).toBe(4);
    expect(db.requests.filter((r) => r.target === "profiles").map((r) => (r.payload as { id: string }).id)).toEqual(["user-a", "user-b"]);

    const otherClient = createRecordingSupabase({ userId: "user-a", reply: (r) => (r.target === "is_super_admin" ? { data: false } : undefined) });
    await ensureDefaultWorkspaceMembership(otherClient.client as never);
    expect(otherClient.lines()).toContain("profiles.upsert");
  });
});
