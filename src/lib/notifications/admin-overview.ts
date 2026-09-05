/**
 * The notifications console's data: everything an owner/admin needs to answer
 * "did it run, did it send, did it arrive, and what can I do about it". Service
 * role only — the route checks has_workspace_role before constructing the client,
 * and every read is scoped to the caller's workspace.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { kindLabel } from "@/domain/notifications/channels";
import { assessRunFreshness, type RunFreshness } from "@/domain/notifications/health";
import { classifyLedgerRow, type LedgerState } from "@/domain/notifications/ledger-state";
import type { Database } from "@/lib/database.types";
import { MAX_SEND_ATTEMPTS, snapshotContent } from "@/lib/sop/notifications-drain";
import { latestDeliveryStatuses, listSuppressions, type SuppressionRow } from "./deliveries-store";
import { latestDrainRuns, type DrainRun } from "./drain-runs-store";
import { loadTeamsIntegration, type TeamsIntegrationSettings } from "./integrations-store";
import { listTransactionalEmails, type TransactionalEmailRow } from "./transactional-log";

export type LedgerName = "sop_notifications" | "workspace_notifications" | "notification_digests";

export interface LedgerRowView {
  id: number;
  ledger: LedgerName;
  kind: string;
  state: LedgerState;
  recipientId: string;
  recipientName: string;
  recipientEmail: string | null;
  subject: string;
  createdAt: string;
  sentAt: string | null;
  attempts: number;
  lastError: string | null;
  skippedReason: string | null;
  /** Latest Resend webhook event for the message, e.g. "email.delivered"; null when none. */
  deliveryStatus: string | null;
}

export interface AdminOverview {
  health: RunFreshness;
  runs: DrainRun[];
  ledger: LedgerRowView[];
  transactional: TransactionalEmailRow[];
  suppressions: SuppressionRow[];
  integration: TeamsIntegrationSettings | null;
}

const LEDGER_LIMIT = 60;

interface RawLedgerRow {
  id: number;
  ledger: LedgerName;
  kind: string;
  recipient_id: string;
  created_at: string;
  sent_at: string | null;
  attempts: number;
  last_error: string | null;
  skipped_reason: string | null;
  resend_message_id: string | null;
  content: unknown;
  fallbackSubject: string;
}

async function loadSopLedger(admin: SupabaseClient<Database>, workspaceId: string): Promise<RawLedgerRow[]> {
  const { data, error } = await admin
    .from("sop_notifications")
    .select(
      "id, kind, recipient_id, created_at, sent_at, attempts, last_error, skipped_reason, resend_message_id, content, sops!inner(workspace_id, title, sop_number)",
    )
    .eq("sops.workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(LEDGER_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const sop = (row as unknown as { sops: { title: string | null; sop_number: string | null } | null }).sops;
    const label = [sop?.sop_number, sop?.title].filter(Boolean).join(" ");
    return {
      id: Number(row.id),
      ledger: "sop_notifications" as const,
      kind: String(row.kind),
      recipient_id: String(row.recipient_id),
      created_at: String(row.created_at),
      sent_at: (row.sent_at as string | null) ?? null,
      attempts: Number(row.attempts ?? 0),
      last_error: (row.last_error as string | null) ?? null,
      skipped_reason: (row.skipped_reason as string | null) ?? null,
      resend_message_id: (row.resend_message_id as string | null) ?? null,
      content: row.content,
      fallbackSubject: label ? `${kindLabel(String(row.kind))} · ${label}` : kindLabel(String(row.kind)),
    };
  });
}

async function loadWorkspaceLedger(
  admin: SupabaseClient<Database>,
  table: "workspace_notifications" | "notification_digests",
  workspaceId: string,
): Promise<RawLedgerRow[]> {
  const { data, error } = await admin
    .from(table)
    .select("id, kind, recipient_id, created_at, sent_at, attempts, last_error, skipped_reason, resend_message_id, content")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(LEDGER_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: Number(row.id),
    ledger: table,
    kind: String(row.kind),
    recipient_id: String(row.recipient_id),
    created_at: String(row.created_at),
    sent_at: (row.sent_at as string | null) ?? null,
    attempts: Number(row.attempts ?? 0),
    last_error: (row.last_error as string | null) ?? null,
    skipped_reason: (row.skipped_reason as string | null) ?? null,
    resend_message_id: (row.resend_message_id as string | null) ?? null,
    content: row.content,
    fallbackSubject: kindLabel(String(row.kind)),
  }));
}

export async function loadAdminOverview(
  admin: SupabaseClient<Database>,
  workspaceId: string,
  now: Date,
): Promise<AdminOverview> {
  const [runs, sopRows, workspaceRows, digestRows, transactional, suppressions, integration] = await Promise.all([
    latestDrainRuns(admin, 10),
    loadSopLedger(admin, workspaceId),
    loadWorkspaceLedger(admin, "workspace_notifications", workspaceId),
    loadWorkspaceLedger(admin, "notification_digests", workspaceId),
    listTransactionalEmails(admin, workspaceId, 30),
    listSuppressions(admin, 100),
    loadTeamsIntegration(admin, workspaceId),
  ]);

  const raw = [...sopRows, ...workspaceRows, ...digestRows]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, LEDGER_LIMIT);

  const recipientIds = Array.from(new Set(raw.map((row) => row.recipient_id)));
  const [profiles, deliveries] = await Promise.all([
    recipientIds.length
      ? admin.from("profiles").select("id, full_name, email").in("id", recipientIds)
      : Promise.resolve({ data: [], error: null }),
    latestDeliveryStatuses(
      admin,
      raw.map((row) => row.resend_message_id).filter((id): id is string => Boolean(id)),
    ),
  ]);
  if (profiles.error) throw new Error(profiles.error.message);
  const profileById = new Map((profiles.data ?? []).map((row) => [row.id, row]));

  const ledger: LedgerRowView[] = raw.map((row) => {
    const profile = profileById.get(row.recipient_id);
    return {
      id: row.id,
      ledger: row.ledger,
      kind: row.kind,
      state: classifyLedgerRow({
        sentAt: row.sent_at,
        attempts: row.attempts,
        lastError: row.last_error,
        skippedReason: row.skipped_reason,
        maxAttempts: MAX_SEND_ATTEMPTS,
      }),
      recipientId: row.recipient_id,
      recipientName: profile?.full_name || profile?.email || "Unknown member",
      recipientEmail: profile?.email ?? null,
      subject: snapshotContent(row.content)?.subject ?? row.fallbackSubject,
      createdAt: row.created_at,
      sentAt: row.sent_at,
      attempts: row.attempts,
      lastError: row.last_error,
      skippedReason: row.skipped_reason,
      deliveryStatus: row.resend_message_id ? (deliveries.get(row.resend_message_id)?.latestEvent ?? null) : null,
    };
  });

  return {
    health: assessRunFreshness(now, runs),
    runs,
    ledger,
    transactional,
    suppressions,
    integration,
  };
}

/**
 * Revive an unsent row so the next drain retries it: attempts, error, and skip
 * cleared. Refuses rows outside the caller's workspace and rows already sent.
 */
export async function resetLedgerRow(
  admin: SupabaseClient<Database>,
  ledger: LedgerName,
  id: number,
  workspaceId: string,
): Promise<boolean> {
  const owner =
    ledger === "sop_notifications"
      ? await admin.from("sop_notifications").select("id, sent_at, sops!inner(workspace_id)").eq("id", id)
      : await admin.from(ledger).select("id, sent_at, workspace_id").eq("id", id);
  if (owner.error) throw new Error(owner.error.message);
  const rows = (owner.data ?? []) as { sent_at: string | null; workspace_id?: string; sops?: { workspace_id: string } }[];
  const row = rows[0];
  if (!row || row.sent_at) return false;
  const rowWorkspace = ledger === "sop_notifications" ? row.sops?.workspace_id : row.workspace_id;
  if (rowWorkspace !== workspaceId) return false;

  const { error } = await admin
    .from(ledger)
    .update({ attempts: 0, last_error: null, last_attempt_at: null, skipped_reason: null })
    .eq("id", id);
  if (error) throw new Error(error.message);
  return true;
}
