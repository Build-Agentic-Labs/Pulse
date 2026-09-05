import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createStalledDigestDrainStore } from "./digest-store";

type Result = { data: unknown; count?: number; error: { message: string; code?: string } | null };

interface Capture {
  inserts: { table: string; values: Record<string, unknown> }[];
}

function makeAdmin(results: Record<string, Result>, capture?: Capture) {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      is: () => builder,
      or: () => builder,
      not: () => builder,
      lt: () => builder,
      lte: () => builder,
      in: () => builder,
      eq: () => builder,
      gte: () => builder,
      order: () => builder,
      single: () => builder,
      insert: (values: Record<string, unknown>) => {
        capture?.inserts.push({ table, values });
        return builder;
      },
      update: () => builder,
      then: (resolve: (r: Result) => void) => resolve(results[table] ?? { data: [], error: null }),
    });
    return builder;
  };
  return { from } as unknown as SupabaseClient<Database>;
}

const NOW = new Date("2026-09-04T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000).toISOString();
const OWNER = "2a000000-0000-0000-0000-000000000001";
const QUALITY = "2a000000-0000-0000-0000-000000000002";
const REVIEWER = "2a000000-0000-0000-0000-000000000003";
const origin = "https://pulse.example.com";

function fixtures(over: Partial<Record<string, Result>> = {}): Record<string, Result> {
  return {
    workspaces: { data: [{ id: "ws-1", name: "Anacorp" }], error: null },
    sops: {
      data: [
        {
          id: "sop-1", workspace_id: "ws-1", title: "Line Clearance", sop_number: "", version: "A", status: "in_review",
          deleted_at: null, created_by: OWNER, submitted_by: OWNER, content_hash: "h", final_approval_requested_at: null,
          final_approval_content_hash: null, rejected_reason: null, review_cycle: 0, approved_at: null, updated_at: daysAgo(12),
          department_id: "dept-prd",
        },
      ],
      error: null,
    },
    departments: { data: [{ id: "dept-prd", workspace_id: "ws-1", name: "Production", code: "PRD", is_quality_gate: false }, { id: "dept-q", workspace_id: "ws-1", name: "Quality", code: "QA", is_quality_gate: true }], error: null },
    sop_review_seats: { data: [{ sop_id: "sop-1", department_id: "dept-prd", rasic: "responsible", signer_id: REVIEWER }], error: null },
    sop_review_submissions: { data: [], error: null },
    sop_review_annotations: { data: [], error: null },
    sop_signatures: { data: [], error: null },
    workspace_members: { data: [{ workspace_id: "ws-1", user_id: OWNER, role: "owner" }, { workspace_id: "ws-1", user_id: REVIEWER, role: "editor" }], error: null },
    department_members: { data: [{ department_id: "dept-q", user_id: QUALITY, dept_role: "approver" }], error: null },
    profiles: { data: [{ id: OWNER, email: "owner@anacorp.com" }, { id: QUALITY, email: "q@anacorp.com" }], error: null },
    notification_preferences: { data: [], error: null },
    email_suppressions: { data: [], error: null },
    notification_digests: { data: [], error: null },
    ...over,
  };
}

describe("createStalledDigestDrainStore.collect", () => {
  it("emits one digest per owner/admin and Quality approver, describing every stalled SOP", async () => {
    const store = createStalledDigestDrainStore(makeAdmin(fixtures()));
    expect(store.ledger).toBe("notification_digests");
    const batch = await store.collect(NOW, origin);
    expect(batch.items.map((item) => item.pending)).toEqual([
      { recipientId: OWNER, kind: "stalled_weekly", workspaceId: "ws-1", periodKey: "2026-W36" },
      { recipientId: QUALITY, kind: "stalled_weekly", workspaceId: "ws-1", periodKey: "2026-W36" },
    ]);
    expect(batch.items[0].email).toBe("owner@anacorp.com");
    expect(batch.items[0].content.subject).toBe("Stalled SOP work this week: 1 SOP in Anacorp");
    expect(batch.items[0].content.text).toContain("PRD · Line Clearance — 12 days, waiting on 1 review outstanding (Production)");
    expect(batch.items[0].inbox).toEqual({ link: "/sops/review", entityType: "workspace", entityId: "ws-1", workspaceId: "ws-1" });
    expect(batch.items[0].channels).toEqual({ email: true, suppressed: false });
  });

  it("emits nothing when no SOP has stalled", async () => {
    const store = createStalledDigestDrainStore(makeAdmin(fixtures({ sops: { data: [], error: null } })));
    expect((await store.collect(NOW, origin)).items).toEqual([]);
  });
});

describe("createStalledDigestDrainStore.claim", () => {
  it("claims on the period key and writes the inbox row", async () => {
    const capture: Capture = { inserts: [] };
    const store = createStalledDigestDrainStore(makeAdmin(fixtures({ notification_digests: { data: { id: 3 }, error: null } }), capture));
    const content = { subject: "Stalled SOP work this week: 1 SOP in Anacorp", text: "One SOP has stalled.\n\nDetails", html: "<p>h</p>" };
    const result = await store.claim({
      pending: { recipientId: OWNER, kind: "stalled_weekly", workspaceId: "ws-1", periodKey: "2026-W36" },
      email: "owner@anacorp.com",
      content,
      channels: { email: true, suppressed: false },
      inbox: { link: "/sops/review", entityType: "workspace", entityId: "ws-1", workspaceId: "ws-1" },
    });
    expect(result).toEqual({ claimed: true, ledgerId: 3 });
    expect(capture.inserts[0]).toEqual({
      table: "notification_digests",
      values: { workspace_id: "ws-1", recipient_id: OWNER, kind: "stalled_weekly", period_key: "2026-W36", content },
    });
    expect(capture.inserts[1].table).toBe("notifications");
    expect(capture.inserts[1].values).toMatchObject({ source: "digest", source_ledger_id: 3, title: content.subject, body: "One SOP has stalled." });
  });
});
