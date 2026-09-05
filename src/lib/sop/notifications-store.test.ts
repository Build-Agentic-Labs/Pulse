import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createSopNotificationDrainStore } from "./notifications-store";

type Result = { data: unknown; count?: number; error: { message: string } | null };

interface Capture {
  inserts: { table: string; values: Record<string, unknown> }[];
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

describe("createSopNotificationDrainStore.claim", () => {
  it("writes the review cycle and the rendered content onto the ledger row", async () => {
    const capture: Capture = { inserts: [] };
    const admin = makeAdmin(
      fixtures({ sop_notifications: { data: { id: 7 }, error: null } }),
      capture,
    );
    const store = createSopNotificationDrainStore(admin);
    const content = { subject: "s", text: "t", html: "<p>h</p>" };
    const claimed = await store.claim(
      { recipientId: AUTHOR, kind: "review_complete", sopId: "sop-1", eventId: 50, reminderIndex: 0, reviewCycle: 2 },
      content,
    );
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
    ]);
  });
});
