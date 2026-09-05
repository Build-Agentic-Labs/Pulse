import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createSopNotificationDrainStore } from "./notifications-store";

type Result = { data: unknown; count?: number; error: { message: string } | null };

interface Capture {
  inserts: { table: string; values: Record<string, unknown> }[];
  updates?: { table: string; values: Record<string, unknown> }[];
}

// Table-dispatching fake: each `from(table)` yields a thenable builder whose chain
// methods no-op. One dataset per table serves every query against that table, which
// is enough to prove how collect() assembles the domain context.
function makeAdmin(results: Record<string, Result>, capture?: Capture) {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      is: () => builder,
      or: () => builder,
      not: () => builder,
      lt: () => builder,
      in: () => builder,
      eq: () => builder,
      gte: () => builder,
      order: () => builder,
      single: () => builder,
      maybeSingle: () => builder,
      insert: (values: Record<string, unknown>) => {
        capture?.inserts.push({ table, values });
        return builder;
      },
      update: (values: Record<string, unknown>) => {
        capture?.updates?.push({ table, values });
        return builder;
      },
      then: (resolve: (r: Result) => void) => resolve(results[table] ?? { data: [], error: null }),
    });
    return builder;
  };
  return { from } as unknown as SupabaseClient<Database>;
}

const origin = "https://pulse.example.com";
const AUTHOR = "1a000000-0000-0000-0000-000000000001";
const REVIEWER = "1a000000-0000-0000-0000-000000000002";

const sopRow = {
  id: "sop-1",
  workspace_id: "ws-1",
  title: "Line Clearance",
  sop_number: "SOP-0042",
  version: "C",
  status: "in_review",
  deleted_at: null,
  created_by: AUTHOR,
  submitted_by: AUTHOR,
  content_hash: "hash-1",
  final_approval_requested_at: null,
  final_approval_content_hash: null,
  rejected_reason: null,
  review_cycle: 0,
  approved_at: null,
};

function fixtures(over: Partial<Record<string, Result>> = {}): Record<string, Result> {
  return {
    sop_event_log: {
      data: [
        {
          id: 50,
          sop_id: "sop-1",
          review_cycle: 0,
          event_type: "review_returned",
          actor_id: REVIEWER,
          actor_name: "Rosendo Lopez",
          details: { no_changes: true, reviewer_id: REVIEWER },
          created_at: "2026-07-29T18:27:33Z",
        },
      ],
      error: null,
    },
    sop_notifications: { data: [], error: null },
    sops: { data: [sopRow], error: null },
    sop_review_seats: {
      data: [{ sop_id: "sop-1", department_id: "dept-eng", rasic: "responsible", signer_id: REVIEWER }],
      error: null,
    },
    departments: { data: [{ id: "dept-eng", workspace_id: "ws-1", name: "Engineering", is_quality_gate: false }], error: null },
    department_members: { data: [], error: null },
    sop_signatures: { data: [], error: null },
    sop_review_submissions: {
      data: [{ sop_id: "sop-1", reviewer_id: REVIEWER, review_cycle: 0, no_changes: true, submitted_at: "2026-07-29T18:27:33Z" }],
      error: null,
    },
    sop_review_annotations: { data: [], error: null },
    profiles: { data: [{ id: AUTHOR, email: "author@anacorp.com" }], error: null },
    ...over,
  };
}

describe("createSopNotificationDrainStore.collect — author stall context", () => {
  const now = new Date("2026-09-04T12:00:00Z");

  it("hands the domain the review returns and open-remark count, so a completed review reaches the author", async () => {
    const store = createSopNotificationDrainStore(makeAdmin(fixtures()));
    const batch = await store.collect(now, origin);
    const firstTouch = batch.items.filter((item) => item.pending.eventId !== null);
    expect(firstTouch).toHaveLength(1);
    expect(firstTouch[0].pending).toEqual({
      recipientId: AUTHOR,
      kind: "review_complete",
      sopId: "sop-1",
      eventId: 50,
      reminderIndex: 0,
      reviewCycle: 0,
    });
    expect(firstTouch[0].email).toBe("author@anacorp.com");
    expect(firstTouch[0].content.subject).toBe('Ready for final approval: SOP-0042 "Line Clearance"');
  });

  it("counts only UNRESOLVED current-cycle remarks as blocking", async () => {
    const store = createSopNotificationDrainStore(
      makeAdmin(
        fixtures({
          sop_review_annotations: {
            data: [
              { sop_id: "sop-1", review_cycle: 0, resolved_at: null },
            ],
            error: null,
          },
        }),
      ),
    );
    const batch = await store.collect(now, origin);
    expect(batch.items.filter((item) => item.pending.kind === "review_complete")).toEqual([]);
  });

  it("nudges the author with a reminder keyed on the current cycle once the stall is old enough", async () => {
    const store = createSopNotificationDrainStore(makeAdmin(fixtures({ sop_event_log: { data: [], error: null } })));
    const batch = await store.collect(now, origin);
    const reminders = batch.items.filter((item) => item.pending.eventId === null);
    expect(reminders.map((item) => item.pending)).toEqual([
      { recipientId: AUTHOR, kind: "review_complete", sopId: "sop-1", eventId: null, reminderIndex: 1, reviewCycle: 0 },
    ]);
    expect(reminders[0].content.subject).toContain("Reminder: Ready for final approval");
  });
});

describe("createSopNotificationDrainStore.retryItems", () => {
  const now = new Date("2026-09-04T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000).toISOString();
  const stored = { subject: "Review requested: SOP-0042 \"Line Clearance\" (Rev C)", text: "as first sent", html: "<p>as first sent</p>" };

  it("names its ledger so the drain can key idempotent sends", () => {
    expect(createSopNotificationDrainStore(makeAdmin(fixtures())).ledger).toBe("sop_notifications");
  });

  it("resends the snapshotted content byte-for-byte instead of re-rendering with a generic actor", async () => {
    const admin = makeAdmin(
      fixtures({
        sop_notifications: {
          data: [
            {
              id: 9,
              sop_id: "sop-1",
              recipient_id: REVIEWER,
              kind: "review_requested",
              reminder_index: 0,
              review_cycle: 0,
              attempts: 0,
              last_attempt_at: null,
              created_at: hoursAgo(2),
              content: stored,
            },
          ],
          error: null,
        },
        profiles: { data: [{ id: REVIEWER, email: "reviewer@anacorp.com" }], error: null },
      }),
    );
    const items = await createSopNotificationDrainStore(admin).retryItems(now, origin);
    expect(items).toEqual([{ ledgerId: 9, email: "reviewer@anacorp.com", content: stored, attempts: 0 }]);
  });

  it("re-renders only rows claimed before content snapshots existed", async () => {
    const admin = makeAdmin(
      fixtures({
        sop_notifications: {
          data: [
            {
              id: 3,
              sop_id: "sop-1",
              recipient_id: REVIEWER,
              kind: "review_requested",
              reminder_index: 0,
              review_cycle: 0,
              attempts: 0,
              last_attempt_at: null,
              created_at: hoursAgo(2),
              content: null,
            },
          ],
          error: null,
        },
        profiles: { data: [{ id: REVIEWER, email: "reviewer@anacorp.com" }], error: null },
      }),
    );
    const items = await createSopNotificationDrainStore(admin).retryItems(now, origin);
    expect(items[0].content.subject).toBe('Review requested: SOP-0042 "Line Clearance" (Rev C)');
    expect(items[0].content.text).toContain("Pulse sent");
  });
});

describe("createSopNotificationDrainStore.deadRows", () => {
  it("counts rows that exhausted every attempt without sending", async () => {
    const admin = makeAdmin(fixtures({ sop_notifications: { data: [], count: 3, error: null } as Result }));
    expect(await createSopNotificationDrainStore(admin).deadRows!(new Date("2026-09-04T12:00:00Z"))).toBe(3);
  });
});

describe("createSopNotificationDrainStore.collect — escalation", () => {
  const now = new Date("2026-08-15T12:00:00Z");
  const MANAGER = "1a000000-0000-0000-0000-000000000009";

  it("escalates an ignored stall to the workspace owner, naming the stalled reviewer", async () => {
    const store = createSopNotificationDrainStore(
      makeAdmin(
        fixtures({
          sop_event_log: {
            data: [
              { id: 45, sop_id: "sop-1", review_cycle: 0, event_type: "review_sent", actor_id: AUTHOR, actor_name: "Ana", details: {}, created_at: "2026-07-29T18:20:45Z" },
            ],
            error: null,
          },
          sop_review_submissions: { data: [], error: null },
          sop_notifications: {
            data: [
              { sop_id: "sop-1", recipient_id: REVIEWER, kind: "review_requested", reminder_index: 1, review_cycle: 0, sent_at: "2026-08-02T13:00:00Z", event_id: null },
              { sop_id: "sop-1", recipient_id: REVIEWER, kind: "review_requested", reminder_index: 2, review_cycle: 0, sent_at: "2026-08-05T13:00:00Z", event_id: null },
              { event_id: 45, recipient_id: REVIEWER },
            ],
            error: null,
          },
          workspace_members: { data: [{ workspace_id: "ws-1", user_id: MANAGER, role: "owner" }], error: null },
          profiles: { data: [{ id: MANAGER, email: "owner@anacorp.com", full_name: "Olivia Owner" }, { id: REVIEWER, email: "r@anacorp.com", full_name: "Tomas Bach" }], error: null },
        }),
      ),
    );
    const batch = await store.collect(now, origin);
    const escalation = batch.items.find((item) => item.pending.kind === "stall_escalated");
    expect(escalation?.pending).toEqual({ recipientId: MANAGER, kind: "stall_escalated", sopId: "sop-1", eventId: null, reminderIndex: 1, reviewCycle: 0 });
    expect(escalation?.email).toBe("owner@anacorp.com");
    expect(escalation?.content.text).toContain("Tomas Bach (Engineering seat)");
  });
});

describe("createSopNotificationDrainStore.collect — channels", () => {
  const now = new Date("2026-09-04T12:00:00Z");

  it("turns the email channel off for a recipient whose preference says so, keeping the decision", async () => {
    const store = createSopNotificationDrainStore(
      makeAdmin(
        fixtures({
          notification_preferences: {
            data: [{ user_id: AUTHOR, workspace_id: "", kind: "review_complete", channel: "email", mode: "off" }],
            error: null,
          },
        }),
      ),
    );
    const batch = await store.collect(now, origin);
    const first = batch.items.find((item) => item.pending.eventId === 50);
    expect(first?.channels).toEqual({ email: false, suppressed: false, teams: null, push: null });
    expect(first?.inbox).toEqual({ link: "/sops/sop-1", entityType: "sop", entityId: "sop-1", workspaceId: "ws-1" });
  });

  it("flags a suppressed address so the drain never mails it again", async () => {
    const store = createSopNotificationDrainStore(
      makeAdmin(fixtures({ email_suppressions: { data: [{ email: "author@anacorp.com" }], error: null } })),
    );
    const batch = await store.collect(now, origin);
    expect(batch.items.find((item) => item.pending.eventId === 50)?.channels).toEqual({ email: true, suppressed: true, teams: null, push: null });
  });
});

describe("createSopNotificationDrainStore.collect — Teams", () => {
  const now = new Date("2026-09-04T12:00:00Z");

  it("attaches the workspace's enabled webhook to ONE item per decision, so a channel gets one post per event", async () => {
    const SECOND = "1a000000-0000-0000-0000-000000000003";
    const store = createSopNotificationDrainStore(
      makeAdmin(
        fixtures({
          sop_event_log: {
            data: [
              { id: 45, sop_id: "sop-1", review_cycle: 0, event_type: "review_sent", actor_id: AUTHOR, actor_name: "Ana", details: {}, created_at: "2026-09-04T11:00:00Z" },
            ],
            error: null,
          },
          sop_review_seats: {
            data: [
              { sop_id: "sop-1", department_id: "dept-eng", rasic: "responsible", signer_id: REVIEWER },
              { sop_id: "sop-1", department_id: "dept-ops", rasic: "accountable", signer_id: SECOND },
            ],
            error: null,
          },
          sop_review_submissions: { data: [], error: null },
          workspace_integrations: {
            data: [{ workspace_id: "ws-1", kind: "teams_webhook", enabled: true, config: { webhookUrl: "https://a.webhook.office.com/x" } }],
            error: null,
          },
          profiles: { data: [{ id: REVIEWER, email: "r@anacorp.com" }, { id: SECOND, email: "s@anacorp.com" }], error: null },
        }),
      ),
    );
    const batch = await store.collect(now, origin);
    const firstTouch = batch.items.filter((item) => item.pending.eventId === 45);
    expect(firstTouch).toHaveLength(2);
    expect(firstTouch.map((item) => item.channels.teams)).toEqual([{ webhookUrl: "https://a.webhook.office.com/x" }, null]);
  });
});

describe("createSopNotificationDrainStore.recordChannel", () => {
  it("stamps the channel outcome onto the inbox row that points at the ledger row", async () => {
    const capture: Capture = { inserts: [], updates: [] };
    const store = createSopNotificationDrainStore(makeAdmin(fixtures(), capture));
    await store.recordChannel!(9, "teams", "sent");
    expect(capture.updates).toEqual([{ table: "notifications", values: { delivered_channels: { teams: "sent" } } }]);
  });
});

describe("createSopNotificationDrainStore.claim", () => {
  const content = { subject: 'Ready for final approval: SOP-0042 "Line Clearance"', text: "Every reviewer has responded.\n\nOpen it.", html: "<p>h</p>" };
  const claimItem = {
    pending: { recipientId: AUTHOR, kind: "review_complete" as const, sopId: "sop-1", eventId: 50, reminderIndex: 0, reviewCycle: 2 },
    email: "author@anacorp.com",
    content,
    channels: { email: true, suppressed: false },
    inbox: { link: "/sops/sop-1", entityType: "sop", entityId: "sop-1", workspaceId: "ws-1" },
  };

  it("writes the review cycle and the rendered content onto the ledger row, then an inbox row pointing back at it", async () => {
    const capture: Capture = { inserts: [] };
    const admin = makeAdmin(fixtures({ sop_notifications: { data: { id: 7 }, error: null } }), capture);
    const store = createSopNotificationDrainStore(admin);
    const claimed = await store.claim(claimItem);
    expect(claimed).toEqual({ claimed: true, ledgerId: 7 });
    expect(capture.inserts).toEqual([
      {
        table: "sop_notifications",
        values: {
          sop_id: "sop-1",
          recipient_id: AUTHOR,
          kind: "review_complete",
          event_id: 50,
          reminder_index: 0,
          review_cycle: 2,
          content,
        },
      },
      {
        table: "notifications",
        values: {
          recipient_id: AUTHOR,
          workspace_id: "ws-1",
          source: "sop",
          source_ledger_id: 7,
          kind: "review_complete",
          entity_type: "sop",
          entity_id: "sop-1",
          title: 'Ready for final approval: SOP-0042 "Line Clearance"',
          body: "Every reviewer has responded.",
          link: "/sops/sop-1",
        },
      },
    ]);
  });

  it("a lost claim race writes no inbox row either", async () => {
    const capture: Capture = { inserts: [] };
    const admin = makeAdmin(
      fixtures({ sop_notifications: { data: null, error: { message: "duplicate", code: "23505" } as never } }),
      capture,
    );
    const store = createSopNotificationDrainStore(admin);
    expect(await store.claim(claimItem)).toEqual({ claimed: false, ledgerId: null });
    expect(capture.inserts.map((insert) => insert.table)).toEqual(["sop_notifications"]);
  });
});

describe("createSopNotificationDrainStore.markSkipped", () => {
  it("stamps the reason so the row is terminal without a send", async () => {
    const capture: Capture = { inserts: [], updates: [] };
    const store = createSopNotificationDrainStore(makeAdmin(fixtures(), capture));
    await store.markSkipped!(9, "preference");
    expect(capture.updates).toEqual([{ table: "sop_notifications", values: { skipped_reason: "preference" } }]);
  });
});
