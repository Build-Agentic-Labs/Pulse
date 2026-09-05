/**
 * Delivery tracking (email_deliveries + email_suppressions). Service-role only —
 * construct the client inside the webhook route. Replays are a no-op because the
 * webhook event id is unique.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResendWebhookEvent } from "@/domain/notifications/resend-webhook";
import type { Database, Json } from "@/lib/database.types";

export interface DeliveryRecordOutcome {
  recorded: boolean;
  duplicate: boolean;
  suppressed: number;
}

export async function recordDeliveryEvent(
  admin: SupabaseClient<Database>,
  event: ResendWebhookEvent & { payload: unknown },
): Promise<DeliveryRecordOutcome> {
  const { error } = await admin.from("email_deliveries").insert({
    webhook_event_id: event.eventId,
    resend_message_id: event.messageId,
    event_type: event.type,
    recipient_email: event.recipients[0] ?? null,
    occurred_at: event.occurredAt,
    payload: event.payload as Json,
  });
  if (error) {
    if (error.code === "23505") return { recorded: false, duplicate: true, suppressed: 0 };
    throw new Error(error.message);
  }

  let suppressed = 0;
  for (const suppression of event.suppress ?? []) {
    const { error: suppressError } = await admin
      .from("email_suppressions")
      .upsert(
        { email: suppression.email, reason: suppression.reason, source_message_id: event.messageId },
        { onConflict: "email", ignoreDuplicates: true },
      );
    if (suppressError) throw new Error(suppressError.message);
    suppressed += 1;
  }
  return { recorded: true, duplicate: false, suppressed };
}

export interface DeliveryStatus {
  resendMessageId: string;
  latestEvent: string;
  occurredAt: string;
}

/** Latest delivery event per message id, for the admin console's ledger view. */
export async function latestDeliveryStatuses(
  admin: SupabaseClient<Database>,
  messageIds: readonly string[],
): Promise<Map<string, DeliveryStatus>> {
  const unique = Array.from(new Set(messageIds.filter(Boolean)));
  if (unique.length === 0) return new Map();
  const { data, error } = await admin
    .from("email_deliveries")
    .select("resend_message_id, event_type, occurred_at")
    .in("resend_message_id", unique)
    .order("occurred_at", { ascending: true });
  if (error) throw new Error(error.message);
  const latest = new Map<string, DeliveryStatus>();
  for (const row of data ?? []) {
    if (!row.resend_message_id) continue;
    // Ascending order: the last write per message wins = latest event.
    latest.set(row.resend_message_id, {
      resendMessageId: row.resend_message_id,
      latestEvent: String(row.event_type),
      occurredAt: String(row.occurred_at),
    });
  }
  return latest;
}

export interface SuppressionRow {
  email: string;
  reason: string;
  sourceMessageId: string | null;
  createdAt: string;
}

export async function listSuppressions(admin: SupabaseClient<Database>, limit = 100): Promise<SuppressionRow[]> {
  const { data, error } = await admin
    .from("email_suppressions")
    .select("email, reason, source_message_id, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    email: String(row.email),
    reason: String(row.reason),
    sourceMessageId: (row.source_message_id as string | null) ?? null,
    createdAt: String(row.created_at),
  }));
}

export async function removeSuppression(admin: SupabaseClient<Database>, email: string): Promise<void> {
  const { error } = await admin.from("email_suppressions").delete().eq("email", email.trim().toLowerCase());
  if (error) throw new Error(error.message);
}
