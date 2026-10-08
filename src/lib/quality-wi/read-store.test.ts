import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { listQualityWis } from "./read-store";

function fixture(data: unknown[]) {
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(), range: vi.fn().mockResolvedValue({ data, error: null }),
  };
  return { query, client: { from: vi.fn(() => query) } as unknown as SupabaseClient<Database> };
}

it("requests only unpublished documents or pending draft revisions for the builder", async () => {
  const { client, query } = fixture([]);
  await listQualityWis("workspace", client);
  expect(query.eq).toHaveBeenCalledWith("workspace_id", "workspace");
  expect(query.or).toHaveBeenCalledWith("published_revision_id.is.null,has_changes.eq.true");
  expect(query.not).not.toHaveBeenCalled();
});

it("shows the released title and date even when a new working draft exists", async () => {
  const { client, query } = fixture([{
    id: "wi", workspace_id: "workspace", department_id: "d", department: { code: "INS", name: "Inside Sales" },
    title: "Unfinished new title", version: 8, has_changes: true, published_revision_id: "release", document_number: "WI-INS-001",
    updated_at: "2026-10-08", release: { title: "Released title", published_at: "2026-10-01" },
  }]);
  const rows = await listQualityWis("workspace", client, "published");
  expect(query.not).toHaveBeenCalledWith("published_revision_id", "is", null);
  expect(query.or).not.toHaveBeenCalled();
  expect(rows[0]).toMatchObject({ title: "Released title", updatedAt: "2026-10-01", hasChanges: false, publishedRevisionId: "release" });
});

it("does not substitute draft content when a published revision is unavailable", async () => {
  const { client } = fixture([{ id: "wi", title: "Draft title", release: null }]);
  await expect(listQualityWis("workspace", client, "published")).rejects.toThrow("published work instruction could not be loaded");
});
