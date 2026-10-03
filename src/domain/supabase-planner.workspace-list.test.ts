import { describe, expect, it, vi } from "vitest";
import { ensureDefaultWorkspaceMembership, loadWorkspaceProjectGroups } from "./supabase-planner";

const USER = "user-a";
const NOW = "2026-10-03T12:00:00.000Z";
type Row = Record<string, unknown>;
type Read = { table: string; from: number; to: number; orders: string[]; filters: Array<[string, unknown]> };

function fixture(rows: Record<string, Row[]>, options: { superAdmin?: boolean; failure?: { table: string; from: number; code?: string } } = {}) {
  const reads: Read[] = [];
  const client = {
    rpc: vi.fn(async (_name: string) => ({ data: options.superAdmin ?? false, error: null })),
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const orders: string[] = [];
      const query = {
        select() { return query; },
        eq(column: string, value: unknown) { filters.push([column, value]); return query; },
        in(column: string, value: string[]) { filters.push([column, value]); return query; },
        order(column: string) { orders.push(column); return query; },
        async range(from: number, to: number) {
          reads.push({ table, from, to, orders, filters });
          if (options.failure?.table === table && options.failure.from === from) {
            return { data: null, error: { message: "Read failed", code: options.failure.code ?? "08006" } };
          }
          const filtered = (rows[table] ?? []).filter((row) => filters.every(([column, value]) =>
            Array.isArray(value) ? value.includes(row[column]) : row[column] === value));
          filtered.sort((a, b) => {
            for (const column of orders) {
              const comparison = String(a[column] ?? "").localeCompare(String(b[column] ?? ""));
              if (comparison) return comparison;
            }
            return 0;
          });
          return { data: filtered.slice(from, to + 1), error: null };
        },
      };
      return query;
    },
  };
  return { client, reads };
}

function workspace(id: string, created_at = NOW) { return { id, name: id, created_at, updated_at: NOW }; }
function project(id: string, workspace_id: string) { return { id, workspace_id, name: id, created_at: NOW, updated_at: NOW }; }
function membership(workspace_id: string, role = "viewer") { return { user_id: USER, workspace_id, role, created_at: NOW }; }

describe("workspace directory collection reads", () => {
  it("shares concurrent navigation reads and rereads after they finish", async () => {
    const rows = {
      workspace_members: [membership("w-1", "editor")], workspaces: [workspace("w-1")],
      projects: [project("p-1", "w-1")], project_access: [],
    };
    const { client, reads } = fixture(rows);
    const results = await Promise.all(Array.from({ length: 4 }, () => loadWorkspaceProjectGroups(USER, client as never)));
    expect(results.every((groups) => groups === results[0])).toBe(true);
    expect(reads.map((read) => read.table).sort()).toEqual(["project_access", "projects", "workspace_members", "workspaces"]);
    // Access changes must be visible on the next refresh, without waiting for a TTL.
    rows.workspace_members[0].role = "viewer";
    const refreshed = await loadWorkspaceProjectGroups(USER, client as never);
    expect(refreshed[0].role).toBe("viewer");
    expect(refreshed[0].projects).toEqual([]);
    expect(reads).toHaveLength(8);
  });

  it("never shares concurrent groups between server clients or different users", async () => {
    const rows = {
      workspace_members: [membership("w-a", "editor"), { ...membership("w-b", "viewer"), user_id: "user-b" }],
      workspaces: [workspace("w-a"), workspace("w-b")], projects: [], project_access: [],
    };
    const a = fixture(rows);
    const b = fixture(rows);
    const results = await Promise.all([
      loadWorkspaceProjectGroups(USER, a.client as never),
      loadWorkspaceProjectGroups("user-b", a.client as never),
      loadWorkspaceProjectGroups(USER, b.client as never),
    ]);
    expect(results.map((groups) => groups[0].workspace.id)).toEqual(["w-a", "w-b", "w-a"]);
    expect(results[0]).not.toBe(results[2]);
    expect(a.reads.filter((read) => read.table === "workspace_members")).toHaveLength(2);
    expect(b.reads.filter((read) => read.table === "workspace_members")).toHaveLength(1);
  });

  it("retries a failed shared read instead of retaining a rejected promise", async () => {
    const failure = { table: "workspace_members", from: 0 };
    const { client, reads } = fixture({
      workspace_members: [membership("w-1")], workspaces: [workspace("w-1")], projects: [], project_access: [],
    }, { failure });
    const attempts = await Promise.allSettled([
      loadWorkspaceProjectGroups(USER, client as never), loadWorkspaceProjectGroups(USER, client as never),
    ]);
    expect(attempts.every((attempt) => attempt.status === "rejected")).toBe(true);
    failure.table = "none";
    expect((await loadWorkspaceProjectGroups(USER, client as never))[0].workspace.id).toBe("w-1");
    expect(reads.filter((read) => read.table === "workspace_members")).toHaveLength(2);
  });

  it("starts a fresh read after grant redemption while an older read is pending", async () => {
    const rows = {
      workspace_members: [] as Row[], workspaces: [workspace("w-new")], projects: [], project_access: [],
    };
    const { client, reads } = fixture(rows);
    Object.assign(client, { auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: USER } } } })) } });
    const originalFrom = client.from.bind(client);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let blocked = false;
    let first = true;
    client.from = ((table: string) => {
      if (table === "profiles") return { upsert: async () => ({ error: null }) };
      const query = originalFrom(table);
      if (table === "workspace_members") {
        const originalRange = query.range.bind(query);
        query.range = async (from, to) => {
          const result = await originalRange(from, to);
          if (first) { first = false; blocked = true; await held; }
          return result;
        };
      }
      return query;
    }) as typeof client.from;
    client.rpc.mockImplementation(async (name) => {
      if (name === "redeem_workspace_access_grants") rows.workspace_members.push(membership("w-new", "editor"));
      return { data: false, error: null };
    });
    const beforeRedemption = loadWorkspaceProjectGroups(USER, client as never);
    await vi.waitFor(() => expect(blocked).toBe(true));
    const afterRedemption = ensureDefaultWorkspaceMembership(client as never);
    try {
      await vi.waitFor(() => expect(reads.filter((read) => read.table === "workspace_members")).toHaveLength(2));
      expect((await afterRedemption)[0].workspace.id).toBe("w-new");
    } finally { release(); await beforeRedemption; }
  });

  it("includes late-page project grants without exposing projects lacking access", async () => {
    const allowed = Array.from({ length: 1203 }, (_, i) => project(`p-${String(i).padStart(4, "0")}`, "w-1"));
    const { client, reads } = fixture({
      workspace_members: [membership("w-1")], workspaces: [workspace("w-1")],
      projects: [...allowed, project("private-project", "w-1")],
      project_access: allowed.map((row) => ({ user_id: USER, project_id: row.id, level: "view" })),
    });
    const groups = await loadWorkspaceProjectGroups(USER, client as never);
    expect(groups[0].projects.map((item) => item.id)).toEqual(allowed.map((item) => item.id));
    expect(groups[0].projects.every((item) => item.accessLevel === "view")).toBe(true);
    expect(reads.filter((read) => read.table === "project_access").map((read) => read.from)).toEqual([0, 500, 1000]);
    expect(reads.filter((read) => read.table === "projects").map((read) => read.from)).toEqual([0, 500, 1000]);
    expect(reads.every((read) => read.to - read.from === 499)).toBe(true);
  });

  it("loads memberships beyond one page and preserves global workspace order across ID batches", async () => {
    const workspaces = Array.from({ length: 603 }, (_, i) => workspace(`w-${String(i).padStart(4, "0")}`, i === 602 ? "2020-01-01T00:00:00.000Z" : NOW));
    const { client, reads } = fixture({
      workspace_members: workspaces.map((row) => membership(row.id, "owner")),
      workspaces, projects: [project("last-workspace-product", workspaces[602].id)], project_access: [],
    });
    const groups = await loadWorkspaceProjectGroups(USER, client as never);
    expect(groups).toHaveLength(603);
    expect(groups[0].workspace.id).toBe(workspaces[602].id);
    expect(groups[0].projects[0]).toMatchObject({ id: "last-workspace-product", accessLevel: "edit" });
    expect(reads.filter((read) => read.table === "workspace_members").map((read) => read.from)).toEqual([0, 500]);
    expect(reads.flatMap((read) => read.filters).filter(([, value]) => Array.isArray(value)).every(([, value]) => (value as string[]).length <= 100)).toBe(true);
  });

  it("paginates the superadmin directory without requiring membership rows", async () => {
    const workspaces = Array.from({ length: 1001 }, (_, i) => workspace(`w-${String(i).padStart(4, "0")}`));
    const { client } = fixture({ workspaces, projects: [project("product-last", workspaces[1000].id)] }, { superAdmin: true });
    const groups = await loadWorkspaceProjectGroups(USER, client as never);
    expect(groups).toHaveLength(1001);
    expect(groups[1000]).toMatchObject({ isSuperAdmin: true, role: "owner", projects: [{ id: "product-last" }] });
  });

  it.each(["projects", "project_access"])("rejects later-page %s failure instead of returning incomplete access data", async (table) => {
    const projects = Array.from({ length: 501 }, (_, i) => project(`p-${i}`, "w-1"));
    const { client } = fixture({
      workspace_members: [membership("w-1")], workspaces: [workspace("w-1")], projects,
      project_access: projects.map((row) => ({ user_id: USER, project_id: row.id, level: "view" })),
    }, { failure: { table, from: 500 } });
    await expect(loadWorkspaceProjectGroups(USER, client as never)).rejects.toMatchObject({ message: "Read failed" });
  });

  it("retains the existing compatibility behavior only for a missing access table", async () => {
    const { client } = fixture({
      workspace_members: [membership("w-1")], workspaces: [workspace("w-1")], projects: [project("p-1", "w-1")],
    }, { failure: { table: "project_access", from: 0, code: "42P01" } });
    expect((await loadWorkspaceProjectGroups(USER, client as never))[0].projects[0].id).toBe("p-1");
  });
});
