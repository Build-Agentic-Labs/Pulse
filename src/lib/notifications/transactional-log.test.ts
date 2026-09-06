import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { countRecentTransactionalFailures, recordTransactionalEmail } from "./transactional-log";

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

/** Query-builder fake: records filters, resolves with the given rows and exact count. */
function makeFailureReader(
  rows: { error: string | null }[],
  count: number,
  seen: { select: unknown[]; eq: [string, string][]; gte: [string, string][]; order: [string, unknown][] },
) {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: (columns: string, options: unknown) => {
      seen.select.push([columns, options]);
      return builder;
    },
    eq: (column: string, value: string) => {
      seen.eq.push([column, value]);
      return builder;
    },
    gte: (column: string, value: string) => {
      seen.gte.push([column, value]);
      return builder;
    },
    order: (column: string, options: unknown) => {
      seen.order.push([column, options]);
      return builder;
    },
    limit: () => builder,
    then: (resolve: (r: { data: unknown; count: number | null; error: null }) => void) =>
      resolve({ data: rows, count, error: null }),
  });
  return { from: () => builder } as unknown as SupabaseClient<Database>;
}

describe("countRecentTransactionalFailures", () => {
  const since = new Date("2026-09-05T12:00:00Z");

  it("counts failed rows since the cut-off and returns the newest error text", async () => {
    const seen = { select: [] as unknown[], eq: [] as [string, string][], gte: [] as [string, string][], order: [] as [string, unknown][] };
    const admin = makeFailureReader([{ error: "500: generate_link: unexpected_failure" }], 2, seen);

    const result = await countRecentTransactionalFailures(admin, since);

    expect(result).toEqual({ count: 2, latestError: "500: generate_link: unexpected_failure" });
    expect(seen.select).toEqual([["error", { count: "exact" }]]);
    expect(seen.eq).toEqual([["status", "failed"]]);
    expect(seen.gte).toEqual([["created_at", "2026-09-05T12:00:00.000Z"]]);
    expect(seen.order).toEqual([["created_at", { ascending: false }]]);
  });

  it("reports zero with no error when nothing failed", async () => {
    const seen = { select: [] as unknown[], eq: [] as [string, string][], gte: [] as [string, string][], order: [] as [string, unknown][] };
    expect(await countRecentTransactionalFailures(makeFailureReader([], 0, seen), since)).toEqual({ count: 0, latestError: null });
  });
});
