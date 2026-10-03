import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { RETRY_BASE_MINUTES } from "@/lib/sop/notifications-drain";
import { createWorkspaceWelcomeDrainStore } from "./welcome-store";

type Result = { data: unknown; error: { message: string } | null };

// Table-dispatching fake: each `from(table)` yields a thenable builder whose
// chain methods no-op except that claimRetry's guards (id/sent_at/attempts) are
// captured by reference, so an assertion reads them after the later .eq/.is run.
function makeAdmin(results: Record<string, Result>, capture?: { updates: { table: string; values: Record<string, unknown>; guards: Record<string, unknown> }[] }) {
  const from = (table: string) => {
    const guards: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      is: (col: string, val: unknown) => {
        guards[col] = val;
        return builder;
      },
      lt: () => builder,
      in: () => builder,
      gte: () => builder,
      order: () => builder,
      range: () => builder,
      eq: (col: string, val: unknown) => {
        guards[col] = val;
        return builder;
      },
      update: (values: Record<string, unknown>) => {
        capture?.updates.push({ table, values, guards });
        return builder;
      },
      then: (resolve: (r: Result) => void) => resolve(results[table] ?? { data: [], error: null }),
    });
    return builder;
  };
  return { from } as unknown as SupabaseClient<Database>;
}

const origin = "https://pulse.example.com";

describe("createWorkspaceWelcomeDrainStore.collect", () => {
  it("does not queue a second welcome when an invite redemption created the membership", async () => {
    const recipientId = "5f9d2f6e-1c1a-4b7e-9d3e-2a6b8c0d4e1f";
    const createdAt = "2026-08-11T12:00:00.000Z";
    const admin = makeAdmin({
      audit_log: {
        data: [
          {
            id: 7,
            action: "workspace_members.insert",
            workspace_id: "ws-1",
            target_id: recipientId,
            actor_id: recipientId,
            created_at: createdAt,
          },
        ],
        error: null,
      },
      workspace_notifications: { data: [], error: null },
      workspaces: { data: [{ id: "ws-1", name: "Anacorp" }], error: null },
      workspace_members: { data: [{ workspace_id: "ws-1", user_id: recipientId }], error: null },
      profiles: { data: [{ id: recipientId, full_name: "Invitee", email: "invitee@anacorp.com" }], error: null },
      workspace_access_grants: {
        data: [{ workspace_id: "ws-1", redeemed_by: recipientId, redeemed_at: createdAt }],
        error: null,
      },
    });

    const store = createWorkspaceWelcomeDrainStore(admin);
    expect((await store.collect(new Date("2026-08-11T12:01:00.000Z"), origin)).items).toEqual([]);
  });
});

describe("createWorkspaceWelcomeDrainStore.collect — membership kinds", () => {
  const MEMBER = "5f9d2f6e-1c1a-4b7e-9d3e-2a6b8c0d4e1f";
  const ADMIN = "5f9d2f6e-1c1a-4b7e-9d3e-2a6b8c0d4e2a";

  it("turns a role change into a notification for the member, rendered with the actor's name", async () => {
    const admin = makeAdmin({
      audit_log: {
        data: [
          {
            id: 9,
            action: "workspace_members.update",
            workspace_id: "ws-1",
            target_id: MEMBER,
            actor_id: ADMIN,
            details: { old: { role: "viewer" }, new: { role: "admin" } },
            created_at: "2026-09-04T12:00:00.000Z",
          },
        ],
        error: null,
      },
      workspace_notifications: { data: [], error: null },
      workspaces: { data: [{ id: "ws-1", name: "Anacorp" }], error: null },
      workspace_members: { data: [{ workspace_id: "ws-1", user_id: MEMBER }], error: null },
      profiles: {
        data: [
          { id: MEMBER, full_name: "Mia Member", email: "mia@anacorp.com" },
          { id: ADMIN, full_name: "Ada Admin", email: "ada@anacorp.com" },
        ],
        error: null,
      },
      workspace_access_grants: { data: [], error: null },
    });
    const store = createWorkspaceWelcomeDrainStore(admin);
    const batch = await store.collect(new Date("2026-09-04T12:01:00.000Z"), origin);
    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].pending).toEqual({ recipientId: MEMBER, kind: "role_changed", workspaceId: "ws-1", eventId: 9 });
    expect(batch.items[0].content.subject).toBe("Your role in Anacorp changed to Admin");
    expect(batch.items[0].content.text).toContain("Ada Admin changed your role");
    expect(batch.items[0].inbox).toEqual({ link: "/", entityType: "workspace", entityId: "ws-1", workspaceId: "ws-1" });
  });
});

describe("createWorkspaceWelcomeDrainStore.retryItems", () => {
  const now = new Date("2026-07-21T12:00:00Z");
  const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

  it("leases each unsent row off last_attempt_at, attempt-scaled (created_at for never-tried rows)", async () => {
    const admin = makeAdmin({
      workspace_notifications: {
        data: [
          // attempts=1 → 60m lease; last attempt 1m ago → NOT due.
          { id: 1, workspace_id: "ws-1", recipient_id: "u-a", event_id: 10, attempts: 1, last_attempt_at: minsAgo(1), created_at: minsAgo(1) },
          // attempts=1 → 60m lease; last attempt well past it → due.
          { id: 2, workspace_id: "ws-1", recipient_id: "u-b", event_id: 11, attempts: 1, last_attempt_at: minsAgo(RETRY_BASE_MINUTES * 2 + 5), created_at: minsAgo(RETRY_BASE_MINUTES * 2 + 5) },
          // attempts=0, never attempted → 30m lease off created_at → due.
          { id: 3, workspace_id: "ws-1", recipient_id: "u-c", event_id: 12, attempts: 0, last_attempt_at: null, created_at: minsAgo(RETRY_BASE_MINUTES + 5) },
        ],
        error: null,
      },
      workspaces: { data: [{ id: "ws-1", name: "Anacorp" }], error: null },
      workspace_members: { data: [], error: null },
      profiles: {
        data: [
          { id: "u-a", full_name: "A", email: "a@x.com" },
          { id: "u-b", full_name: "B", email: "b@x.com" },
          { id: "u-c", full_name: "C", email: "c@x.com" },
        ],
        error: null,
      },
    });
    const store = createWorkspaceWelcomeDrainStore(admin);
    const items = await store.retryItems(now, origin);
    // The row still inside its lease (id 1) is held back; the two past it return.
    expect(items.map((item) => item.ledgerId)).toEqual([2, 3]);
    expect(items.map((item) => item.attempts)).toEqual([1, 0]);
    expect(items.find((item) => item.ledgerId === 2)?.email).toBe("b@x.com");
  });

  it("names its ledger and resends the snapshotted content when a row has one", async () => {
    const stored = { subject: "Welcome to Anacorp on Pulse", text: "as first sent", html: "<p>as first sent</p>" };
    const admin = makeAdmin({
      workspace_notifications: {
        data: [
          { id: 4, workspace_id: "ws-1", recipient_id: "u-a", event_id: 10, attempts: 0, last_attempt_at: null, created_at: minsAgo(RETRY_BASE_MINUTES + 5), content: stored },
        ],
        error: null,
      },
      workspaces: { data: [{ id: "ws-1", name: "Anacorp" }], error: null },
      profiles: { data: [{ id: "u-a", full_name: "A", email: "a@x.com" }], error: null },
    });
    const store = createWorkspaceWelcomeDrainStore(admin);
    expect(store.ledger).toBe("workspace_notifications");
    expect(await store.retryItems(now, origin)).toEqual([{ ledgerId: 4, email: "a@x.com", content: stored, attempts: 0 }]);
  });

  it("returns nothing when every unsent row is still inside its lease", async () => {
    const admin = makeAdmin({
      workspace_notifications: {
        data: [
          { id: 1, workspace_id: "ws-1", recipient_id: "u-a", event_id: 10, attempts: 1, last_attempt_at: minsAgo(1), created_at: minsAgo(1) },
        ],
        error: null,
      },
    });
    const store = createWorkspaceWelcomeDrainStore(admin);
    expect(await store.retryItems(now, origin)).toEqual([]);
  });
});

describe("createWorkspaceWelcomeDrainStore.claimRetry", () => {
  it("wins the row with a conditional bump guarded on the expected attempt count", async () => {
    const capture = { updates: [] as { table: string; values: Record<string, unknown>; guards: Record<string, unknown> }[] };
    // Update matches one row → the caller owns this attempt.
    const admin = makeAdmin({ workspace_notifications: { data: [{ id: 42 }], error: null } }, capture);
    const store = createWorkspaceWelcomeDrainStore(admin);

    expect(await store.claimRetry!(42, 1)).toBe(true);
    expect(capture.updates).toHaveLength(1);
    expect(capture.updates[0].values).toEqual({ attempts: 2, last_attempt_at: expect.any(String) });
    expect(capture.updates[0].guards).toEqual({ id: 42, sent_at: null, attempts: 1 });
  });

  it("loses when a concurrent drain already advanced the row (zero rows updated)", async () => {
    // Update matches no rows because attempts already moved past `expected`.
    const admin = makeAdmin({ workspace_notifications: { data: [], error: null } });
    const store = createWorkspaceWelcomeDrainStore(admin);
    expect(await store.claimRetry!(42, 1)).toBe(false);
  });
});

// Model the REST row cap and actual filters rather than returning an unlimited
// table. Large fixtures must survive pagination, duplicate IDs and later errors.
function pagedAdmin(tables: Record<string, Record<string, unknown>[]>, fail?: { table: string; offset: number }) {
  const reads: { table: string; filters: Record<string, unknown[]>; offset: number }[] = [];
  const admin = {
    from(table: string) {
      const filters: Record<string, unknown[]> = {};
      const predicates: ((row: Record<string, unknown>) => boolean)[] = [];
      const orders: string[] = [];
      let offset = 0; let end = 999;
      const builder = {
        select() { return builder; },
        in(column: string, ids: unknown[]) { filters[column] = ids; predicates.push((row) => ids.includes(row[column])); return builder; },
        eq(column: string, value: unknown) { predicates.push((row) => row[column] === value); return builder; },
        is(column: string, value: unknown) { return builder.eq(column, value); },
        lt(column: string, value: number) { predicates.push((row) => Number(row[column]) < value); return builder; },
        gte(column: string, value: string) { predicates.push((row) => String(row[column]) >= value); return builder; },
        order(column: string) { orders.push(column); return builder; },
        range(from: number, to: number) { offset = from; end = to; return builder; },
        then(resolve: (result: Result) => void) {
          reads.push({ table, filters, offset });
          const data = (tables[table] ?? []).filter((row) => predicates.every((predicate) => predicate(row)))
            .sort((a, b) => {
              for (const column of orders) {
                if (a[column] === b[column]) continue;
                return typeof a[column] === 'number' && typeof b[column] === 'number'
                  ? Number(a[column]) - Number(b[column]) : String(a[column]).localeCompare(String(b[column]));
              }
              return 0;
            }).slice(offset, Math.min(end + 1, offset + 1000));
          resolve({ data, error: fail?.table === table && fail.offset === offset ? { message: 'Later page unavailable' } : null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient<Database>;
  return { admin, reads };
}

const backlogUser = (id: number) => `00000000-0000-0000-0000-${id.toString(16).padStart(12, "0")}`;

function backlogFixture(count: number) {
  const createdAt = '2026-10-03T12:00:00.000Z';
  const tables: Record<string, Record<string, unknown>[]> = {
    audit_log: [], workspace_notifications: [], workspaces: [], workspace_members: [], profiles: [],
    workspace_access_grants: [], notification_preferences: [], email_suppressions: [],
  };
  for (let id = 1; id <= count; id++) {
    const recipient = backlogUser(id); const workspace = `workspace-${id}`;
    tables.audit_log.push({ id, action: 'workspace_members.insert', workspace_id: workspace, target_id: recipient, actor_id: null, created_at: createdAt });
    tables.workspaces.push({ id: workspace, name: `Workspace ${id}` });
    tables.workspace_members.push({ workspace_id: workspace, user_id: recipient });
    tables.profiles.push({ id: recipient, full_name: `Member ${id}`, email: `member${id}@example.com` });
  }
  return { tables, createdAt };
}

const BACKLOG_NOW = new Date('2026-10-03T12:01:00.000Z');

describe('workspace notification backlog', () => {
  it('collects beyond the API cap with bounded lookups and preserves every delivery rule', async () => {
    const { tables, createdAt } = backlogFixture(2107);
    // Covered, no longer a member and invited welcomes are still excluded.
    tables.workspace_notifications.push({ id: 1, event_id: 1, recipient_id: backlogUser(1) });
    tables.workspace_members = tables.workspace_members.filter((row) => row.user_id !== backlogUser(2));
    tables.workspace_access_grants.push({ workspace_id: 'workspace-3', email: 'member3@example.com', redeemed_by: backlogUser(3), redeemed_at: createdAt });
    tables.notification_preferences.push({ user_id: backlogUser(2106), workspace_id: 'workspace-2106', channel: 'email', kind: 'workspace_welcome', mode: 'off' });
    tables.email_suppressions.push({ email: 'member2107@example.com' });
    const { admin, reads } = pagedAdmin(tables);
    const batch = await createWorkspaceWelcomeDrainStore(admin).collect(BACKLOG_NOW, origin);
    expect(batch.items).toHaveLength(2104);
    expect(new Set(batch.items.map((item) => item.pending.eventId)).size).toBe(2104);
    expect(batch.items.find((item) => item.pending.eventId === 2106)?.channels.email).toBe(false);
    expect(batch.items.find((item) => item.pending.eventId === 2107)?.channels.suppressed).toBe(true);
    expect(reads.filter((read) => read.table === 'audit_log').map((read) => read.offset)).toEqual([0,500,1000,1500,2000]);
    expect(Math.max(...reads.flatMap((read) => Object.values(read.filters).map((ids) => ids.length)))).toBeLessThanOrEqual(100);
  });

  it('reads large child collections completely within one lookup batch', async () => {
    const { tables, createdAt } = backlogFixture(1);
    // All these members share one workspace. The relevant member sorts last.
    tables.workspace_members = Array.from({ length: 1200 }, (_, id) => ({ workspace_id: 'workspace-1', user_id: `a-${id}` }));
    tables.workspace_members.push({ workspace_id: 'workspace-1', user_id: backlogUser(1) });
    // Grant matching the membership is on a later page as well.
    tables.workspace_access_grants = Array.from({ length: 1200 }, (_, id) => ({ workspace_id: 'workspace-1', email: `a${id}@example.com`, redeemed_by: backlogUser(1), redeemed_at: '2026-09-01T00:00:00Z' }));
    tables.workspace_access_grants.push({ workspace_id: 'workspace-1', email: 'z@example.com', redeemed_by: backlogUser(1), redeemed_at: createdAt });
    const { admin, reads } = pagedAdmin(tables);
    expect((await createWorkspaceWelcomeDrainStore(admin).collect(BACKLOG_NOW, origin)).items).toEqual([]);
    expect(reads.filter((read) => read.table === 'workspace_members').map((read) => read.offset)).toEqual([0,500,1000]);
    expect(reads.filter((read) => read.table === 'workspace_access_grants').map((read) => read.offset)).toEqual([0,500,1000]);
  });

  it('includes all due retries after the first page and preserves content and leases', async () => {
    const { tables } = backlogFixture(1205);
    const content = { subject: 'Recorded subject', text: 'Recorded text', html: '<p>Recorded text</p>' };
    tables.workspace_notifications = tables.audit_log.map((event) => ({ id: event.id, workspace_id: event.workspace_id, recipient_id: event.target_id, attempts: 0, last_attempt_at: null, created_at: '2026-10-03T10:00:00Z', sent_at: null, skipped_reason: null, content }));
    tables.workspace_notifications[0].last_attempt_at = BACKLOG_NOW.toISOString();
    const { admin } = pagedAdmin(tables);
    const retries = await createWorkspaceWelcomeDrainStore(admin).retryItems!(BACKLOG_NOW, origin);
    expect(retries).toHaveLength(1204);
    expect(new Set(retries.map((item) => item.ledgerId)).size).toBe(1204);
    expect(retries.find((item) => item.ledgerId === 1205)).toMatchObject({ email: 'member1205@example.com', attempts: 0, content });
  });

  it('honors preferences and suppressions located beyond the first response page', async () => {
    const { tables } = backlogFixture(1);
    const recipient = backlogUser(1);
    tables.notification_preferences = Array.from({ length: 1200 }, (_, id) => ({ user_id: recipient, workspace_id: `a-${id}`, kind: 'workspace_welcome', channel: 'email', mode: 'immediate' }));
    tables.notification_preferences.push({ user_id: recipient, workspace_id: 'workspace-1', kind: 'workspace_welcome', channel: 'email', mode: 'off' });
    tables.email_suppressions.push({ email: 'member1@example.com' });
    const { admin } = pagedAdmin(tables);
    const batch = await createWorkspaceWelcomeDrainStore(admin).collect(BACKLOG_NOW, origin);
    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].channels).toMatchObject({ email: false, suppressed: true });
  });

  it('propagates a later page failure instead of using a partial delivery bundle', async () => {
    const { tables } = backlogFixture(1200);
    const { admin } = pagedAdmin(tables, { table: 'audit_log', offset: 500 });
    await expect(createWorkspaceWelcomeDrainStore(admin).collect(BACKLOG_NOW, origin)).rejects.toThrow('Later page unavailable');
  });
});
