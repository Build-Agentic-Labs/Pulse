import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { loadAdminOverview, resetLedgerRow } from "./admin-overview";

type Result = { data: unknown; error: { message: string } | null };

interface Capture {
  updates: { table: string; values: Record<string, unknown>; guards: Record<string, unknown> }[];
}

function makeAdmin(results: Record<string, Result>, capture?: Capture) {
  const from = (table: string) => {
    const guards: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        guards[col] = val;
        return builder;
      },
      is: (col: string, val: unknown) => {
        guards[col] = val;
        return builder;
      },
      in: () => builder,
      or: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => builder,
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

const NOW = new Date("2026-09-04T15:00:00Z");
const REVIEWER = "4a000000-0000-0000-0000-000000000001";

describe("loadAdminOverview", () => {
  it("assembles health, runs, a classified ledger with names and delivery status, suppressions, and the integration", async () => {
    const admin = makeAdmin({
      notification_drain_runs: {
        data: [{ id: 1, caller: "cron", started_at: "2026-09-04T13:00:00Z", finished_at: "2026-09-04T13:00:02Z", healthy: true, problems: [], report: { sop: { sent: 1 } } }],
        error: null,
      },
      sop_notifications: {
        data: [
          {
            id: 7, kind: "review_requested", recipient_id: REVIEWER, created_at: "2026-09-04T12:00:00Z", sent_at: "2026-09-04T12:00:01Z",
            attempts: 1, last_error: null, skipped_reason: null, resend_message_id: "re_1", review_cycle: 0,
            content: { subject: "Review requested: SOP-0042", text: "t", html: "h" }, sops: { workspace_id: "ws-1", title: "Line Clearance", sop_number: "SOP-0042" },
          },
          {
            id: 8, kind: "review_complete", recipient_id: REVIEWER, created_at: "2026-09-03T12:00:00Z", sent_at: null,
            attempts: 3, last_error: "422: Invalid `to` field", skipped_reason: null, resend_message_id: null, review_cycle: 0,
            content: null, sops: { workspace_id: "ws-1", title: "Line Clearance", sop_number: "SOP-0042" },
          },
        ],
        error: null,
      },
      workspace_notifications: { data: [], error: null },
      notification_digests: { data: [], error: null },
      profiles: { data: [{ id: REVIEWER, full_name: "Tomas Bach", email: "tomas@anacorp.com" }], error: null },
      email_deliveries: { data: [{ resend_message_id: "re_1", event_type: "email.delivered", occurred_at: "2026-09-04T12:00:05Z" }], error: null },
      email_suppressions: { data: [{ email: "dead@anacorp.com", reason: "hard_bounce", source_message_id: null, created_at: "2026-09-01T00:00:00Z" }], error: null },
      transactional_emails: { data: [{ id: 1, kind: "invite", recipient_email: "x@anacorp.com", workspace_id: "ws-1", resend_message_id: "re_9", status: "sent", error: null, created_at: "2026-09-02T00:00:00Z" }], error: null },
      workspace_integrations: { data: { workspace_id: "ws-1", kind: "teams_webhook", enabled: true, config: { webhookUrl: "https://a.webhook.office.com/x" }, updated_at: "2026-09-01T00:00:00Z" }, error: null },
    });
    const overview = await loadAdminOverview(admin, "ws-1", NOW);
    expect(overview.health.healthy).toBe(true);
    expect(overview.runs).toHaveLength(1);
    expect(overview.ledger.map((row) => [row.id, row.ledger, row.state, row.recipientName, row.deliveryStatus])).toEqual([
      [7, "sop_notifications", "sent", "Tomas Bach", "email.delivered"],
      [8, "sop_notifications", "dead", "Tomas Bach", null],
    ]);
    expect(overview.ledger[0].subject).toBe("Review requested: SOP-0042");
    expect(overview.ledger[1].subject).toBe("Ready for final approval · SOP-0042 Line Clearance");
    expect(overview.suppressions.map((row) => row.email)).toEqual(["dead@anacorp.com"]);
    expect(overview.transactional).toHaveLength(1);
    expect(overview.integration).toEqual({ webhookUrl: "https://a.webhook.office.com/x", enabled: true, updatedAt: "2026-09-01T00:00:00Z" });
  });
});

describe("resetLedgerRow", () => {
  it("revives an unsent row in the caller's workspace: attempts, error, and skip cleared", async () => {
    const capture: Capture = { updates: [] };
    const admin = makeAdmin(
      { sop_notifications: { data: [{ id: 8, sent_at: null, sops: { workspace_id: "ws-1" } }], error: null } },
      capture,
    );
    expect(await resetLedgerRow(admin, "sop_notifications", 8, "ws-1")).toBe(true);
    expect(capture.updates).toEqual([
      {
        table: "sop_notifications",
        values: { attempts: 0, last_error: null, last_attempt_at: null, skipped_reason: null },
        guards: { id: 8 },
      },
    ]);
  });

  it("refuses a row from another workspace or one already sent", async () => {
    const capture: Capture = { updates: [] };
    const other = makeAdmin({ sop_notifications: { data: [{ id: 8, sent_at: null, sops: { workspace_id: "ws-2" } }], error: null } }, capture);
    expect(await resetLedgerRow(other, "sop_notifications", 8, "ws-1")).toBe(false);
    const sent = makeAdmin({ workspace_notifications: { data: [{ id: 3, sent_at: "2026-09-01T00:00:00Z", workspace_id: "ws-1" }], error: null } }, capture);
    expect(await resetLedgerRow(sent, "workspace_notifications", 3, "ws-1")).toBe(false);
    expect(capture.updates).toEqual([]);
  });
});
