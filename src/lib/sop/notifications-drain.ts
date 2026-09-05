/**
 * SOP notification drain — the effects layer. Claims ledger rows (the unique
 * index IS the mutex: a lost insert race means another drain owns that send),
 * emails via Resend's REST API, and stamps results. All DECISIONS (who, what,
 * when) live in src/domain/sop/notifications.ts; all DATA ACCESS lives behind
 * DrainStore so this loop tests against an in-memory fake.
 * Spec: docs/superpowers/specs/2026-07-21-sop-notifications-design.md
 */

import type { PendingNotification, SopEmailContent } from "@/domain/sop/notifications";
import { getBearerToken } from "@/lib/api-auth";

/** After this many attempts an unsent row is dead — visible, never retried. */
export const MAX_SEND_ATTEMPTS = 3;

/** Base spacing of the retry lease. Doubled per attempt so a provider outage
 *  spreads MAX_SEND_ATTEMPTS across hours instead of burning them in minutes. */
export const RETRY_BASE_MINUTES = 30;

/** Minimum wait before a row that has been attempted `attempts` times is due
 *  again: 30m, 60m, 120m. Attempt-scaled backoff, not a flat lease. */
export function retryBackoffMinutes(attempts: number): number {
  return RETRY_BASE_MINUTES * Math.pow(2, Math.max(0, attempts));
}

/** Is a claimed-but-unsent row due for another attempt? Leases off the last
 *  attempt (falling back to creation for a row claimed but never attempted). */
export function isRetryDue(
  now: Date,
  lastAttemptAt: Date | null,
  createdAt: Date,
  attempts: number,
): boolean {
  const base = lastAttemptAt ?? createdAt;
  const dueAt = base.getTime() + retryBackoffMinutes(attempts) * 60 * 1000;
  return dueAt <= now.getTime();
}

/**
 * Read a ledger row's content snapshot back as email content. Null when the row
 * predates snapshots (or the column holds something unexpected), so callers fall
 * back to re-rendering rather than sending a malformed email.
 */
export function snapshotContent(value: unknown): SopEmailContent | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.subject !== "string" || typeof record.text !== "string" || typeof record.html !== "string") {
    return null;
  }
  return { subject: record.subject, text: record.text, html: record.html };
}

/** Cron caller auth: constant bearer, set by Vercel Cron when CRON_SECRET exists. */
export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return false;
  return getBearerToken(request) === secret;
}

/**
 * Whose fault a rejected send is, which decides whether the row may die:
 * - `recipient`  — this address will never accept mail. Terminal.
 * - `transient`  — provider hiccup or rate limit. Retry within the attempt cap.
 * - `configuration` — OUR credentials/headers are wrong. Retrying is futile
 *   until a human intervenes, but the row must NOT die: the moment the config
 *   is fixed, the next drain should deliver it.
 */
export type EmailFailureKind = "recipient" | "transient" | "configuration";

export type EmailSendResult =
  | { ok: true; id: string }
  | { ok: false; status: number; error: string; failure: EmailFailureKind };

export interface EmailSendOptions {
  /**
   * Provider-side dedupe key. The drain keys it on `${ledger}:${row id}`, so if a
   * send succeeds but the ledger stamp is lost, the retry lane's resend returns the
   * original message instead of a second email. Resend honours the key for 24h and
   * answers 409 if the body differs — which is why ledger rows snapshot their content.
   */
  idempotencyKey: string;
}

export type EmailSender = (
  to: string,
  content: SopEmailContent,
  options: EmailSendOptions,
) => Promise<EmailSendResult>;

/** Fields whose rejection indicts the ADDRESS rather than our configuration. */
const RECIPIENT_FIELDS = new Set(["to", "cc", "bcc"]);

/**
 * Sort a Resend rejection into the three buckets above.
 *
 * This exists because the old rule — "any 4xx except 429 is permanent" — could
 * not tell a dead address from our own broken `from` header. On 2026-07-29 a
 * malformed RESEND_FROM returned 422, was read as a bounce, and burned the
 * attempt cap on first contact: the notification was dead forever over a
 * one-line env fix, and nothing surfaced it for two weeks.
 */
export function classifyResendFailure(status: number, body: string): EmailFailureKind {
  if (status === 429 || status >= 500 || status < 400) return "transient";
  // A rejected key or an unverified sending domain is always ours.
  if (status === 401 || status === 403) return "configuration";
  // Resend names the offending field: "Invalid `from` field. ...".
  const field = /invalid\s+`([a-z_]+)`\s+field/i.exec(body)?.[1]?.toLowerCase();
  if (field) return RECIPIENT_FIELDS.has(field) ? "recipient" : "configuration";
  // Unrecognised 4xx: bias toward configuration. A stuck, visible row beats a
  // silently dead one — being wrong here costs a retry, the other way costs mail.
  return "configuration";
}

/** Plain fetch to Resend — deliberately no SDK (zero new dependencies). */
export function createResendSender(apiKey: string, from: string, fetchImpl: typeof fetch = fetch): EmailSender {
  return async (to, content, options) => {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": options.idempotencyKey,
      },
      body: JSON.stringify({ from, to: [to], subject: content.subject, text: content.text, html: content.html }),
    });
    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as { id?: string };
      return { ok: true, id: body.id ?? "" };
    }
    const error = await response.text().catch(() => "");
    return {
      ok: false,
      status: response.status,
      error: error.slice(0, 500),
      failure: classifyResendFailure(response.status, error),
    };
  };
}

export interface DrainItem<P = PendingNotification> {
  pending: P;
  email: string | null;
  content: SopEmailContent;
}

export interface RetryItem {
  ledgerId: number;
  email: string | null;
  content: SopEmailContent;
  attempts: number;
}

export interface DrainBatch<P = PendingNotification> {
  items: DrainItem<P>[];
  /** Health signal: age of the oldest event still owed a notification. */
  oldestUnnotifiedEventAgeHours: number | null;
}

export interface DrainStore<P = PendingNotification> {
  /** The ledger table this store owns — the namespace of every idempotency key it sends under. */
  readonly ledger: string;
  /** Scan events + reminders, resolve recipients, render emails. Read-only. */
  collect(now: Date, origin: string): Promise<DrainBatch<P>>;
  /** Claimed-but-unsent rows past the lease, below the attempt cap. */
  retryItems(now: Date, origin: string): Promise<RetryItem[]>;
  /**
   * Insert the ledger row with the rendered content snapshotted onto it (retries
   * resend that exact content); a unique-index conflict returns claimed:false.
   */
  claim(pending: P, content: SopEmailContent): Promise<{ claimed: boolean; ledgerId: number | null }>;
  /**
   * Atomically claim a retry row for THIS attempt before sending: a conditional
   * bump (attempts+1, last_attempt_at=now) that only matches while the row is
   * still unsent at the expected attempt count. Returns false when a concurrent
   * drain already advanced it — the caller must then skip the send so the two
   * invocations never mail the same row twice. Optional: stores whose retry lane
   * needs no cross-invocation guard omit it.
   */
  claimRetry?(ledgerId: number, expectedAttempts: number): Promise<boolean>;
  markSent(ledgerId: number, messageId: string): Promise<void>;
  markFailed(ledgerId: number, error: string, attemptsAfter: number): Promise<void>;
}

export interface DrainReport {
  configured: boolean;
  sent: number;
  retried: number;
  skippedDuplicate: number;
  skippedNoEmail: number;
  failed: number;
  /** Sends refused by OUR configuration — held, not spent. Non-zero = act now. */
  blocked: number;
  oldestUnnotifiedEventAgeHours: number | null;
}

/** Age at which a still-unsent event stops being latency and starts being an outage. */
export const BACKLOG_ALERT_HOURS = 24;

export interface DrainHealth {
  healthy: boolean;
  /** Human-readable, safe to log. Empty when healthy. */
  problems: string[];
}

/**
 * Turn drain reports into an actionable verdict.
 *
 * The RESEND_FROM outage ran for two weeks because every counter needed to spot
 * it was already being computed and then thrown away. This is the consumer.
 *
 * Deliberately narrow: only `configured:false`, configuration blocks, and a
 * backlog past the threshold count as unhealthy. Ordinary `failed` sends — a
 * dead address, a 500 that will retry — do NOT, because a health check that
 * cries wolf is a health check nobody reads.
 */
export function assessDrainHealth(reports: { label: string; report: DrainReport }[]): DrainHealth {
  const problems: string[] = [];
  for (const { label, report } of reports) {
    if (!report.configured) {
      problems.push(`${label}: email is not configured — no notification can send`);
      continue;
    }
    if (report.blocked > 0) {
      problems.push(
        `${label}: ${report.blocked} send(s) blocked by configuration — check RESEND_FROM and RESEND_API_KEY`,
      );
    }
    const age = report.oldestUnnotifiedEventAgeHours;
    if (age !== null && age >= BACKLOG_ALERT_HOURS) {
      problems.push(`${label}: oldest unnotified event is ${age}h old (threshold ${BACKLOG_ALERT_HOURS}h)`);
    }
  }
  return { healthy: problems.length === 0, problems };
}

export async function runSopNotificationDrain<P = PendingNotification>(deps: {
  store: DrainStore<P>;
  send: EmailSender | null;
  now: () => Date;
  origin: string;
}): Promise<DrainReport> {
  const { store, send } = deps;
  const batch = await store.collect(deps.now(), deps.origin);
  const report: DrainReport = {
    configured: send !== null,
    sent: 0,
    retried: 0,
    skippedDuplicate: 0,
    skippedNoEmail: 0,
    failed: 0,
    blocked: 0,
    oldestUnnotifiedEventAgeHours: batch.oldestUnnotifiedEventAgeHours,
  };
  // Unconfigured: report what WOULD send (and the age signal) but claim nothing,
  // so a later configured drain still owns every send.
  if (!send) return report;

  for (const item of batch.items) {
    if (!item.email) {
      // No claim: the notification stays pending and resolves itself the day
      // the profile gains an address.
      report.skippedNoEmail += 1;
      continue;
    }
    try {
      const { claimed, ledgerId } = await store.claim(item.pending, item.content);
      if (!claimed || ledgerId === null) {
        report.skippedDuplicate += 1;
        continue;
      }
      const outcome = await attemptSend(store, send, ledgerId, item.email, item.content, 0);
      if (outcome === "sent") report.sent += 1;
      else if (outcome === "blocked") report.blocked += 1;
      else report.failed += 1;
    } catch {
      // A store-layer rejection (claim, or the failure bookkeeping itself) must
      // cost only this item. A claimed-but-unstamped row re-enters via the retry lane.
      report.failed += 1;
    }
  }

  for (const retry of await store.retryItems(deps.now(), deps.origin)) {
    if (retry.attempts >= MAX_SEND_ATTEMPTS) continue;
    if (!retry.email) {
      report.skippedNoEmail += 1;
      continue;
    }
    try {
      if (store.claimRetry) {
        // Atomic claim BEFORE the send: the loser of a concurrent-drain race
        // gets false and skips, so a stale unsent row is mailed at most once.
        const claimed = await store.claimRetry(retry.ledgerId, retry.attempts);
        if (!claimed) {
          report.skippedDuplicate += 1;
          continue;
        }
      }
      const outcome = await attemptSend(store, send, retry.ledgerId, retry.email, retry.content, retry.attempts);
      if (outcome === "sent") report.retried += 1;
      else if (outcome === "blocked") report.blocked += 1;
      else report.failed += 1;
    } catch {
      report.failed += 1;
    }
  }

  return report;
}

async function attemptSend<P = PendingNotification>(
  store: DrainStore<P>,
  send: EmailSender,
  ledgerId: number,
  email: string,
  content: SopEmailContent,
  priorAttempts: number,
): Promise<"sent" | "failed" | "blocked"> {
  try {
    const result = await send(email, content, { idempotencyKey: `${store.ledger}:${ledgerId}` });
    if (result.ok) {
      await store.markSent(ledgerId, result.id);
      return "sent";
    }
    // A configuration fault HOLDS the attempt count: the row stays eligible so
    // it delivers itself once someone fixes the credentials. Recipient
    // rejections jump straight to the cap (dead row); transient ones step once.
    const attemptsAfter =
      result.failure === "configuration"
        ? priorAttempts
        : result.failure === "recipient"
          ? MAX_SEND_ATTEMPTS
          : priorAttempts + 1;
    await store.markFailed(ledgerId, `${result.status}: ${result.error}`, attemptsAfter);
    return result.failure === "configuration" ? "blocked" : "failed";
  } catch (error: unknown) {
    // A thrown fetch is a network failure, not a verdict on the address.
    const message = error instanceof Error ? error.message : "Unexpected send error";
    await store.markFailed(ledgerId, message, priorAttempts + 1);
    return "failed";
  }
}
