import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { recordTransactionalEmail } from "./transactional-log";

type Result = { data: unknown; error: { message: string } | null };

function makeAdmin(result: Result, capture: { inserts: Record<string, unknown>[] }) {
  const from = () => {
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      insert: (values: Record<string, unknown>) => {
        capture.inserts.push(values);
        return builder;
      },
      then: (resolve: (r: Result) => void) => resolve(result),
    });
    return builder;
  };
  return { from } as unknown as SupabaseClient<Database>;
}

describe("recordTransactionalEmail", () => {
  it("records an accepted send with the provider message id", async () => {
    const capture = { inserts: [] as Record<string, unknown>[] };
    const ok = await recordTransactionalEmail(makeAdmin({ data: null, error: null }, capture), {
      kind: "invite",
      recipientEmail: "Invitee@Anacorp.com",
      workspaceId: "ws-1",
      result: { ok: true, id: "re_9" },
    });
    expect(ok).toBe(true);
    expect(capture.inserts).toEqual([
      { kind: "invite", recipient_email: "invitee@anacorp.com", recipient_id: null, workspace_id: "ws-1", resend_message_id: "re_9", status: "sent", error: null },
    ]);
  });

  it("records a rejected send with its error, never the content", async () => {
    const capture = { inserts: [] as Record<string, unknown>[] };
    await recordTransactionalEmail(makeAdmin({ data: null, error: null }, capture), {
      kind: "password_recovery",
      recipientEmail: "x@anacorp.com",
      result: { ok: false, status: 422, error: "Invalid `from` field", failure: "configuration" },
    });
    expect(capture.inserts[0]).toMatchObject({ kind: "password_recovery", status: "failed", error: "422: Invalid `from` field", resend_message_id: null });
  });

  it("never throws — a broken ledger must not break an invitation", async () => {
    const capture = { inserts: [] as Record<string, unknown>[] };
    const ok = await recordTransactionalEmail(makeAdmin({ data: null, error: { message: "relation missing" } }, capture), {
      kind: "access_granted",
      recipientEmail: "x@anacorp.com",
      result: { ok: true, id: "re_1" },
    });
    expect(ok).toBe(false);
  });
});
