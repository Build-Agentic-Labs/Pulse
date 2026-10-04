// Characterization of the access reads and writes Phase 5 moves into src/lib/planner/access-store.ts:
// the per-client superadmin check sharing, Quality Module access, project context resolution (which
// decides role + edit access for a loaded project), access setters and the audit log. Runs the real
// functions against a recording client; functions without a client parameter use it as the page's
// shared planner client.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecordingSupabase, type RecordedRequest, type ScriptedReply } from "@/test-support/recording-supabase";
import {
  createProjectWithStarterPlan,
  fetchIsSuperAdmin,
  fetchOrgToolAccess,
  loadAuditLogFromSupabase,
  setOrgToolAccessInSupabase,
  setProjectAccessInSupabase,
} from "./supabase-planner";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

type Reply = (request: RecordedRequest) => ScriptedReply | undefined;
const scope = globalThis as { __buildlogicPlannerSupabaseClient?: unknown };
const asClient = (client: unknown) => client as Parameters<typeof fetchIsSuperAdmin>[0];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => { delete scope.__buildlogicPlannerSupabaseClient; });
afterEach(() => { delete scope.__buildlogicPlannerSupabaseClient; });

describe("superadmin check", () => {
  it("shares one in-flight check per client, never across clients, and checks again once settled", async () => {
    const a = createRecordingSupabase({ reply: (r) => (r.target === "is_super_admin" ? { data: true } : undefined) });
    const b = createRecordingSupabase({ reply: (r) => (r.target === "is_super_admin" ? { data: false } : undefined) });
    const [a1, a2, b1] = await Promise.all([
      fetchIsSuperAdmin(asClient(a.client)), fetchIsSuperAdmin(asClient(a.client)), fetchIsSuperAdmin(asClient(b.client)),
    ]);
    expect([a1, a2, b1]).toEqual([true, true, false]);
    expect(a.lines()).toEqual(["rpc:is_super_admin"]);
    expect(b.lines()).toEqual(["rpc:is_super_admin"]);
    await fetchIsSuperAdmin(asClient(a.client));
    expect(a.lines()).toEqual(["rpc:is_super_admin", "rpc:is_super_admin"]);
  });

  it("treats only `true` as superadmin and a missing function as not superadmin", async () => {
    for (const [data, error, expected] of [
      ["yes", null, false], [1, null, false], [null, { message: "missing", code: "PGRST202" }, false],
    ] as const) {
      const db = createRecordingSupabase({ reply: () => ({ data, error }) });
      await expect(fetchIsSuperAdmin(asClient(db.client))).resolves.toBe(expected);
    }
  });

  it("propagates other failures and does not keep the failed check for later callers", async () => {
    let fail = true;
    const db = createRecordingSupabase({
      reply: () => (fail ? { error: { message: "boom", code: "08006" } } : { data: true }),
    });
    await expect(fetchIsSuperAdmin(asClient(db.client))).rejects.toMatchObject({ message: "boom" });
    fail = false;
    await expect(fetchIsSuperAdmin(asClient(db.client))).resolves.toBe(true);
    expect(db.lines()).toEqual(["rpc:is_super_admin", "rpc:is_super_admin"]);
  });

  it("uses the page's shared client by default", async () => {
    const db = createRecordingSupabase({ reply: () => ({ data: true }) });
    scope.__buildlogicPlannerSupabaseClient = db.client;
    await expect(fetchIsSuperAdmin()).resolves.toBe(true);
    expect(db.lines()).toEqual(["rpc:is_super_admin"]);
  });
});

describe("Quality Module access", () => {
  const orgAccess = (reply: Reply, userId: string | null = "user-1") => {
    const db = createRecordingSupabase({ userId, reply });
    return { db, run: () => fetchOrgToolAccess("ws-1", asClient(db.client)) };
  };

  it("grants edit to superadmins without reading the access table", async () => {
    const { db, run } = orgAccess((r) => (r.target === "is_super_admin" ? { data: true } : undefined));
    await expect(run()).resolves.toBe("edit");
    expect(db.lines()).toEqual(["auth.getSession", "rpc:is_super_admin"]);
  });

  it("returns none when signed out, without reading the access table", async () => {
    const { db, run } = orgAccess(() => undefined, null);
    await expect(run()).resolves.toBe("none");
    expect(db.lines()).toEqual(["auth.getSession", "rpc:is_super_admin"]);
  });

  it("reads the caller's own row in this organization and accepts only view/edit", async () => {
    for (const [row, expected] of [[{ level: "edit" }, "edit"], [{ level: "view" }, "view"], [{ level: "admin" }, "none"], [null, "none"]] as const) {
      const { db, run } = orgAccess((r) => (r.target === "org_tool_access" ? { data: row } : undefined));
      await expect(run()).resolves.toBe(expected);
      expect(db.lines().at(-1)).toBe("org_tool_access.select(level) workspace_id=ws-1 user_id=user-1 | maybeSingle");
    }
  });

  it("degrades to none before the table exists, and propagates other errors", async () => {
    await expect(orgAccess((r) => (r.target === "org_tool_access" ? { error: { message: "x", code: "42P01" } } : undefined)).run())
      .resolves.toBe("none");
    await expect(orgAccess((r) => (r.target === "org_tool_access" ? { error: { message: "denied", code: "42501" } } : undefined)).run())
      .rejects.toMatchObject({ message: "denied" });
  });
});

describe("project context (via project creation)", () => {
  const project = { id: "proj-1", workspace_id: "ws-1", name: "FlexBoost", is_awi_master: false };
  const workspace = { id: "ws-1", name: "ANA" };

  function contextClient(options: { member?: unknown; superAdmin?: boolean; projectAccess?: ScriptedReply; userId?: string | null } = {}) {
    return createRecordingSupabase({
      userId: options.userId === undefined ? "user-1" : options.userId,
      reply: (r) => {
        if (r.target === "create_project_with_starter_plan") return { data: "proj-1" };
        if (r.target === "projects") return { data: project };
        if (r.target === "workspaces") return { data: workspace };
        if (r.target === "workspace_members") return { data: options.member ?? null };
        if (r.target === "is_super_admin") return { data: options.superAdmin ?? false };
        if (r.target === "project_access") return options.projectAccess ?? { data: null };
        return undefined;
      },
    });
  }

  it("creates through the RPC with a trimmed name, then resolves the new project's context", async () => {
    const db = contextClient({ member: { role: "owner" } });
    const context = await createProjectWithStarterPlan("ws-1", "  FlexBoost  ", asClient(db.client));
    expect(db.requests[0]).toMatchObject({ target: "create_project_with_starter_plan", payload: { p_workspace_id: "ws-1", p_name: "FlexBoost" } });
    expect(db.lines()).toEqual([
      "rpc:create_project_with_starter_plan",
      "projects.select(*) id=proj-1 | maybeSingle",
      "auth.getSession",
      "workspaces.select(*) id=ws-1 | maybeSingle",
      "workspace_members.select(role) workspace_id=ws-1 user_id=user-1 | maybeSingle",
      "rpc:is_super_admin",
    ]);
    expect(context).toEqual({
      isAwiMaster: false, projectId: "proj-1", projectName: "FlexBoost", workspaceId: "ws-1", workspaceName: "ANA",
      role: "owner", accessLevel: "edit",
    });
  });

  it("refuses a creation that returns no project id before reading anything", async () => {
    const db = createRecordingSupabase({ reply: () => ({ data: null }) });
    await expect(createProjectWithStarterPlan("ws-1", "X", asClient(db.client))).rejects.toThrow("Project creation did not return a project id.");
    expect(db.lines()).toEqual(["rpc:create_project_with_starter_plan"]);
  });

  it("gives managers and superadmins edit access without a per-project check", async () => {
    const admin = await createProjectWithStarterPlan("ws-1", "X", asClient(contextClient({ member: { role: "admin" } }).client));
    expect(admin).toMatchObject({ role: "admin", accessLevel: "edit" });
    const superDb = contextClient({ superAdmin: true });
    expect(await createProjectWithStarterPlan("ws-1", "X", asClient(superDb.client))).toMatchObject({ role: "owner", accessLevel: "edit" });
    expect(superDb.lines().some((line) => line.startsWith("project_access"))).toBe(false);
  });

  it("maps a non-manager's per-project level onto role gating", async () => {
    for (const [level, role] of [["edit", "editor"], ["view", "viewer"], ["none", undefined]] as const) {
      const db = contextClient({ member: { role: "editor" }, projectAccess: { data: { level } } });
      const context = await createProjectWithStarterPlan("ws-1", "X", asClient(db.client));
      expect(context).toMatchObject({ accessLevel: level });
      expect(context.role).toBe(role);
      expect(db.lines().at(-1)).toBe("project_access.select(level) project_id=proj-1 user_id=user-1 | maybeSingle");
    }
  });

  it("falls back to the legacy workspace role before the access table exists", async () => {
    const db = contextClient({ member: { role: "viewer" }, projectAccess: { error: { message: "missing", code: "PGRST205" } } });
    const context = await createProjectWithStarterPlan("ws-1", "X", asClient(db.client));
    expect(context.role).toBe("viewer");
    expect(context.accessLevel).toBeUndefined();
  });

  it("skips the membership and per-project reads when signed out", async () => {
    const db = contextClient({ userId: null });
    const context = await createProjectWithStarterPlan("ws-1", "X", asClient(db.client));
    expect(context).toMatchObject({ role: undefined, accessLevel: undefined });
    expect(db.lines().filter((line) => line.startsWith("workspace_members") || line.startsWith("project_access"))).toEqual([]);
  });

  it("names the missing project or organization", async () => {
    const noProject = createRecordingSupabase({ reply: (r) => (r.target === "create_project_with_starter_plan" ? { data: "p" } : undefined) });
    await expect(createProjectWithStarterPlan("ws-1", "X", asClient(noProject.client))).rejects.toThrow("Workspace not found or you do not have access to it.");
    const noWorkspace = createRecordingSupabase({
      userId: "user-1",
      reply: (r) => (r.target === "create_project_with_starter_plan" ? { data: "p" } : r.target === "projects" ? { data: project } : undefined),
    });
    await expect(createProjectWithStarterPlan("ws-1", "X", asClient(noWorkspace.client))).rejects.toThrow("Organization not found or you do not have access to it.");
  });
});

describe("access setters", () => {
  it("upserts project and Quality access stamped with the granting user", async () => {
    const db = createRecordingSupabase({ userId: "manager-1" });
    scope.__buildlogicPlannerSupabaseClient = db.client;
    await setProjectAccessInSupabase("proj-1", "user-2", "view");
    await setOrgToolAccessInSupabase("ws-1", "user-2", "edit");
    expect(db.lines()).toEqual(["auth.getSession", "project_access.upsert", "auth.getSession", "org_tool_access.upsert"]);
    expect(db.writes().map(({ payload, options }) => ({ payload, options }))).toEqual([
      { payload: { project_id: "proj-1", user_id: "user-2", level: "view", granted_by: "manager-1" }, options: { onConflict: "project_id,user_id" } },
      { payload: { workspace_id: "ws-1", user_id: "user-2", level: "edit", granted_by: "manager-1" }, options: { onConflict: "workspace_id,user_id" } },
    ]);
  });

  it("surfaces a refused write", async () => {
    scope.__buildlogicPlannerSupabaseClient = createRecordingSupabase({ reply: () => ({ error: { message: "row-level security" } }) }).client;
    await expect(setProjectAccessInSupabase("p", "u", "edit")).rejects.toThrow("row-level security");
  });
});

describe("audit log", () => {
  it("reads organization and platform entries newest first, paged by id", async () => {
    const db = createRecordingSupabase({
      reply: () => ({
        data: [
          { id: "12", workspace_id: "ws-1", actor_id: "a", actor_email: "a@x", action: "grant", target_type: "project_access", target_id: "p", details: { new: { level: "edit" } }, created_at: "2026-10-01" },
          { id: 11, workspace_id: null, actor_id: null, actor_email: null, action: null, target_type: null, target_id: null, details: "text", created_at: "2026-09-30" },
        ],
      }),
    });
    scope.__buildlogicPlannerSupabaseClient = db.client;
    const entries = await loadAuditLogFromSupabase("ws-1");
    await loadAuditLogFromSupabase("ws-1", { beforeId: 11, limit: 5 });
    expect(db.lines()).toEqual([
      "audit_log.select(*) or(workspace_id.eq.ws-1,workspace_id.is.null) | order(id desc) limit(30)",
      "audit_log.select(*) or(workspace_id.eq.ws-1,workspace_id.is.null) id<11 | order(id desc) limit(5)",
    ]);
    expect(entries).toEqual([
      { id: 12, workspaceId: "ws-1", actorId: "a", actorEmail: "a@x", action: "grant", targetType: "project_access", targetId: "p", details: { new: { level: "edit" } }, createdAt: "2026-10-01" },
      { id: 11, workspaceId: undefined, actorId: undefined, actorEmail: undefined, action: "", targetType: "", targetId: undefined, details: undefined, createdAt: "2026-09-30" },
    ]);
  });

  it("is empty before the table exists and propagates other errors", async () => {
    scope.__buildlogicPlannerSupabaseClient = createRecordingSupabase({ reply: () => ({ error: { message: "x", code: "42P01" } }) }).client;
    await expect(loadAuditLogFromSupabase("ws-1")).resolves.toEqual([]);
    scope.__buildlogicPlannerSupabaseClient = createRecordingSupabase({ reply: () => ({ error: { message: "denied", code: "42501" } }) }).client;
    await expect(loadAuditLogFromSupabase("ws-1")).rejects.toMatchObject({ message: "denied" });
  });
});

it("keeps the in-flight superadmin check scoped to the issuing client while it is pending", async () => {
  const gate = deferred<void>();
  const slow = createRecordingSupabase({ reply: () => ({ data: true }) });
  const slowClient = { ...slow.client, rpc: (name: string) => ({ then: (ok: (v: unknown) => unknown) => gate.promise.then(() => ok({ data: true, error: null })), name }) };
  const fast = createRecordingSupabase({ reply: () => ({ data: false }) });
  const pending = fetchIsSuperAdmin(asClient(slowClient));
  await expect(fetchIsSuperAdmin(asClient(fast.client))).resolves.toBe(false);
  gate.resolve();
  await expect(pending).resolves.toBe(true);
});
