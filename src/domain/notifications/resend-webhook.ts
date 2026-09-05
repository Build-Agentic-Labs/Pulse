/**
 * Resend webhook payload → the facts the delivery ledger records. Pure. Only
 * `email.*` events are meaningful here; a permanent bounce or a complaint also
 * yields suppressions, which is what stops the drain from mailing a dead
 * address on every future event.
 */

export type SuppressionReason = "hard_bounce" | "complaint";

export interface Suppression {
  email: string;
  reason: SuppressionReason;
}

export interface ResendWebhookEvent {
  /** The Svix message id from the `svix-id` header — the replay-dedupe key. */
  eventId: string;
  type: string;
  messageId: string | null;
  recipients: string[];
  occurredAt: string;
  suppress: Suppression[] | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** "Name <addr>" or "addr" → "addr", lower-cased. */
function normalizeAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /<([^>]+)>/.exec(value);
  const address = (match ? match[1] : value).trim().toLowerCase();
  return address.includes("@") ? address : null;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function parseResendWebhookEvent(json: unknown, eventId: string, now: Date = new Date()): ResendWebhookEvent | null {
  const root = asRecord(json);
  if (!root || typeof root.type !== "string" || !root.type.startsWith("email.")) return null;
  const data = asRecord(root.data);
  if (!data) return null;

  const recipients = (Array.isArray(data.to) ? data.to : [])
    .map(normalizeAddress)
    .filter((address): address is string => address !== null);
  const messageId = typeof data.email_id === "string" ? data.email_id : null;
  const occurredAt = isoOrNull(root.created_at) ?? isoOrNull(data.created_at) ?? now.toISOString();

  let suppress: Suppression[] | null = null;
  if (root.type === "email.bounced") {
    const bounce = asRecord(data.bounce);
    if (bounce && typeof bounce.type === "string" && bounce.type.toLowerCase() === "permanent") {
      suppress = recipients.map((email) => ({ email, reason: "hard_bounce" as const }));
    }
  } else if (root.type === "email.complained") {
    suppress = recipients.map((email) => ({ email, reason: "complaint" as const }));
  }
  if (suppress && suppress.length === 0) suppress = null;

  return { eventId, type: root.type, messageId, recipients, occurredAt, suppress };
}
