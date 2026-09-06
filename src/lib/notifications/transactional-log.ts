/**
 * The transactional-email ledger (transactional_emails): the record invitation
 * and password-recovery sends never had. Never stores a code, link, or body —
 * only who, what kind, and whether the provider accepted it. Never throws: a
 * broken ledger must not break an invitation.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { EmailSendResult } from "@/lib/sop/notifications-drain";

export type TransactionalEmailKind = "invite" | "access_granted" | "password_recovery";

export interface TransactionalEmailEntry {
  kind: TransactionalEmailKind;
  recipientEmail: string;
  recipientId?: string | null;
  workspaceId?: string | null;
  result: EmailSendResult;
}

export async function recordTransactionalEmail(admin: SupabaseClient<Database>, entry: TransactionalEmailEntry): Promise<boolean> {
  try {
    const { error } = await admin.from("transactional_emails").insert({
      kind: entry.kind,
      recipient_email: entry.recipientEmail.trim().toLowerCase(),
      recipient_id: entry.recipientId ?? null,
      workspace_id: entry.workspaceId ?? null,
      resend_message_id: entry.result.ok ? entry.result.id : null,
      status: entry.result.ok ? "sent" : "failed",
      error: entry.result.ok ? null : `${entry.result.status}: ${entry.result.error}`.slice(0, 1000),
    });
    if (error) {
      console.error("transactional_emails: write failed", { kind: entry.kind, message: error.message });
      return false;
    }
    return true;
  } catch (error: unknown) {
    console.error("transactional_emails: write threw", {
      kind: entry.kind,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export interface RecentTransactionalFailures {
  count: number;
  latestError: string | null;
}

/**
 * Failed reset / invitation sends since `since` — the health endpoint's auth-mail
 * probe. One query: exact count plus the newest row's error text.
 */
export async function countRecentTransactionalFailures(
  admin: SupabaseClient<Database>,
  since: Date,
): Promise<RecentTransactionalFailures> {
  const { data, count, error } = await admin
    .from("transactional_emails")
    .select("error", { count: "exact" })
    .eq("status", "failed")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const latest = data?.[0];
  return { count: count ?? 0, latestError: (latest?.error as string | null) ?? null };
}

export interface TransactionalEmailRow {
  id: number;
  kind: string;
  recipientEmail: string;
  workspaceId: string | null;
  resendMessageId: string | null;
  status: string;
  error: string | null;
  createdAt: string;
}

export async function listTransactionalEmails(
  admin: SupabaseClient<Database>,
  workspaceId: string,
  limit = 50,
): Promise<TransactionalEmailRow[]> {
  const { data, error } = await admin
    .from("transactional_emails")
    .select("id, kind, recipient_email, workspace_id, resend_message_id, status, error, created_at")
    .or(`workspace_id.eq.${workspaceId},workspace_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: Number(row.id),
    kind: String(row.kind),
    recipientEmail: String(row.recipient_email),
    workspaceId: (row.workspace_id as string | null) ?? null,
    resendMessageId: (row.resend_message_id as string | null) ?? null,
    status: String(row.status),
    error: (row.error as string | null) ?? null,
    createdAt: String(row.created_at),
  }));
}
