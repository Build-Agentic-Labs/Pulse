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
