import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { insertInboxRows } from "./inbox-writer";

function fakeAdmin(insert: ReturnType<typeof vi.fn>) {
  return { from: () => ({ insert }) } as unknown as SupabaseClient<Database>;
}

describe("insertInboxRows", () => {
  it("writes one notifications row per input with the body capped", async () => {
    const insert = vi.fn(async (_rows: unknown[]) => ({ error: null }));
    const ok = await insertInboxRows(fakeAdmin(insert), [
      { recipientId: "m-1", workspaceId: "ws", source: "workspace", kind: "reviewer_nominated", entityType: "sop", entityId: "sop-1", title: "T", body: "x".repeat(400), link: "/sops/sop-1" },
    ]);
    expect(ok).toBe(true);
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({ recipient_id: "m-1", workspace_id: "ws", source: "workspace", kind: "reviewer_nominated", source_ledger_id: null, title: "T", link: "/sops/sop-1" }),
    ]);
    expect((insert.mock.calls[0][0] as { body: string }[])[0].body).toHaveLength(280);
  });

  it("is a no-op for an empty list and never throws on a database error", async () => {
    const insert = vi.fn(async () => ({ error: { message: "boom" } }));
    expect(await insertInboxRows(fakeAdmin(insert), [])).toBe(true);
    expect(insert).not.toHaveBeenCalled();
    expect(
      await insertInboxRows(fakeAdmin(insert), [
        { recipientId: "m-1", workspaceId: null, source: "workspace", kind: "k", entityType: null, entityId: null, title: "T", body: "b", link: null },
      ]),
    ).toBe(false);
  });
});
