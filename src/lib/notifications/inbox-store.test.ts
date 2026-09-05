import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { listInbox, markAllInboxRead, markInboxRead } from "./inbox-store";

type Result = { data: unknown; error: { message: string } | null };

function makeClient(results: Record<string, Result>, capture: { rpcs: { name: string; args: unknown }[]; limits: number[] }) {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      order: () => builder,
      limit: (n: number) => {
        capture.limits.push(n);
        return builder;
      },
      then: (resolve: (r: Result) => void) => resolve(results[table] ?? { data: [], error: null }),
    });
    return builder;
  };
  const rpc = async (name: string, args: unknown) => {
    capture.rpcs.push({ name, args });
    return results[`rpc:${name}`] ?? { data: 1, error: null };
  };
  return { from, rpc } as unknown as SupabaseClient<Database>;
}

describe("listInbox", () => {
  it("maps rows newest-first with the requested limit", async () => {
    const capture = { rpcs: [], limits: [] as number[] };
    const client = makeClient(
      {
        notifications: {
          data: [
            { id: 2, kind: "review_complete", title: "Ready for final approval", body: "b", link: "/sops/s1", created_at: "2026-09-04T10:00:00Z", read_at: null, workspace_id: "ws-1" },
            { id: 1, kind: "review_requested", title: "Review requested", body: "", link: null, created_at: "2026-09-03T10:00:00Z", read_at: "2026-09-03T11:00:00Z", workspace_id: null },
          ],
          error: null,
        },
      },
      capture,
    );
    const items = await listInbox(8, client);
    expect(capture.limits).toEqual([8]);
    expect(items).toEqual([
      { id: 2, kind: "review_complete", title: "Ready for final approval", body: "b", link: "/sops/s1", createdAt: "2026-09-04T10:00:00Z", readAt: null, workspaceId: "ws-1" },
      { id: 1, kind: "review_requested", title: "Review requested", body: "", link: null, createdAt: "2026-09-03T10:00:00Z", readAt: "2026-09-03T11:00:00Z", workspaceId: null },
    ]);
  });

  it("surfaces a rejected read", async () => {
    const client = makeClient({ notifications: { data: null, error: { message: "boom" } } }, { rpcs: [], limits: [] });
    await expect(listInbox(8, client)).rejects.toThrow("boom");
  });
});

describe("mark read", () => {
  it("marks the given ids through the RPC, never a direct table write", async () => {
    const capture = { rpcs: [] as { name: string; args: unknown }[], limits: [] };
    const client = makeClient({ "rpc:mark_notifications_read": { data: 2, error: null } }, capture);
    expect(await markInboxRead([2, 5], client)).toBe(2);
    expect(capture.rpcs).toEqual([{ name: "mark_notifications_read", args: { p_ids: [2, 5] } }]);
  });

  it("marks everything read through its RPC", async () => {
    const capture = { rpcs: [] as { name: string; args: unknown }[], limits: [] };
    const client = makeClient({ "rpc:mark_all_notifications_read": { data: 7, error: null } }, capture);
    expect(await markAllInboxRead(client)).toBe(7);
    expect(capture.rpcs).toEqual([{ name: "mark_all_notifications_read", args: {} }]);
  });

  it("does nothing for an empty id list", async () => {
    const capture = { rpcs: [] as { name: string; args: unknown }[], limits: [] };
    const client = makeClient({}, capture);
    expect(await markInboxRead([], client)).toBe(0);
    expect(capture.rpcs).toEqual([]);
  });
});
