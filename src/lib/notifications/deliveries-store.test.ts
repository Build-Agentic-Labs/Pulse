import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { recordDeliveryEvent } from "./deliveries-store";

type Result = { data: unknown; error: { message: string; code?: string } | null };

function makeAdmin(results: Record<string, Result>, capture: { writes: { table: string; op: string; values: unknown; options?: unknown }[] }) {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      insert: (values: unknown) => {
        capture.writes.push({ table, op: "insert", values });
        return builder;
      },
      upsert: (values: unknown, options: unknown) => {
        capture.writes.push({ table, op: "upsert", values, options });
        return builder;
      },
      then: (resolve: (r: Result) => void) => resolve(results[table] ?? { data: null, error: null }),
    });
    return builder;
  };
  return { from } as unknown as SupabaseClient<Database>;
}

const event = {
  eventId: "msg_1",
  type: "email.bounced",
  messageId: "re_1",
  recipients: ["dead@x.com"],
  occurredAt: "2026-09-04T12:00:00.000Z",
  suppress: [{ email: "dead@x.com", reason: "hard_bounce" as const }],
  payload: { type: "email.bounced" },
};

describe("recordDeliveryEvent", () => {
  it("writes the delivery row and upserts a suppression for each named address", async () => {
    const capture = { writes: [] as { table: string; op: string; values: unknown; options?: unknown }[] };
    const outcome = await recordDeliveryEvent(makeAdmin({}, capture), event);
    expect(outcome).toEqual({ recorded: true, duplicate: false, suppressed: 1 });
    expect(capture.writes).toEqual([
      {
        table: "email_deliveries",
        op: "insert",
        values: {
          webhook_event_id: "msg_1",
          resend_message_id: "re_1",
          event_type: "email.bounced",
          recipient_email: "dead@x.com",
          occurred_at: "2026-09-04T12:00:00.000Z",
          payload: { type: "email.bounced" },
        },
      },
      {
        table: "email_suppressions",
        op: "upsert",
        values: { email: "dead@x.com", reason: "hard_bounce", source_message_id: "re_1" },
        options: { onConflict: "email", ignoreDuplicates: true },
      },
    ]);
  });

  it("treats a replayed event as a no-op rather than a failure", async () => {
    const capture = { writes: [] as { table: string; op: string; values: unknown; options?: unknown }[] };
    const admin = makeAdmin({ email_deliveries: { data: null, error: { message: "dup", code: "23505" } } }, capture);
    expect(await recordDeliveryEvent(admin, event)).toEqual({ recorded: false, duplicate: true, suppressed: 0 });
    expect(capture.writes.map((write) => write.table)).toEqual(["email_deliveries"]);
  });

  it("surfaces any other database rejection", async () => {
    const admin = makeAdmin({ email_deliveries: { data: null, error: { message: "relation missing" } } }, { writes: [] });
    await expect(recordDeliveryEvent(admin, event)).rejects.toThrow("relation missing");
  });
});
