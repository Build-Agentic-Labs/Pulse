/**
 * Service-role inbox writes for decisions made OUTSIDE the drains (e.g. a reviewer nomination
 * telling the managers). The drains write their own inbox rows next to their ledger rows; this is
 * for one-off, informational in-app notices with no email channel. Never throws — an inbox miss
 * must not fail the action it reports.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { INBOX_BODY_MAX } from "@/domain/notifications/inbox";
import type { Database } from "@/lib/database.types";

export interface InboxRowInput {
  recipientId: string;
  workspaceId: string | null;
  source: "sop" | "workspace" | "digest";
  kind: string;
  entityType: string | null;
  entityId: string | null;
  title: string;
  body: string;
  link: string | null;
}

export async function insertInboxRows(admin: SupabaseClient<Database>, rows: readonly InboxRowInput[]): Promise<boolean> {
  if (rows.length === 0) return true;
  const { error } = await admin.from("notifications").insert(
    rows.map((row) => ({
      recipient_id: row.recipientId,
      workspace_id: row.workspaceId,
      source: row.source,
      source_ledger_id: null,
      kind: row.kind,
      entity_type: row.entityType,
      entity_id: row.entityId,
      title: row.title,
      body: row.body.slice(0, INBOX_BODY_MAX),
      link: row.link,
    })),
  );
  if (error) {
    console.error("notifications: inbox insert failed", { message: error.message, kind: rows[0]?.kind });
    return false;
  }
  return true;
}
