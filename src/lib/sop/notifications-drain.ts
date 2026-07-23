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

/** Cron caller auth: constant bearer, set by Vercel Cron when CRON_SECRET exists. */
export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return false;
  return getBearerToken(request) === secret;
}

export type EmailSendResult =
  | { ok: true; id: string }
  | { ok: false; status: number; error: string; permanent: boolean };

export type EmailSender = (to: string, content: SopEmailContent) => Promise<EmailSendResult>;

/** Plain fetch to Resend — deliberately no SDK (zero new dependencies). */
export function createResendSender(apiKey: string, from: string): EmailSender {
  return async (to, content) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: content.subject, text: content.text, html: content.html }),
    });
    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as { id?: string };
      return { ok: true, id: body.id ?? "" };
    }
    const error = await response.text().catch(() => "");
    // 4xx (except 429) is a permanent rejection — a bounce-shaped failure we
    // must not retry. 429 and 5xx are transient.
    const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
    return { ok: false, status: response.status, error: error.slice(0, 500), permanent };
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
  /** Scan events + reminders, resolve recipients, render emails. Read-only. */
  collect(now: Date, origin: string): Promise<DrainBatch<P>>;
  /** Claimed-but-unsent rows past the lease, below the attempt cap. */
  retryItems(now: Date, origin: string): Promise<RetryItem[]>;
  /** Insert the ledger row; a unique-index conflict returns claimed:false. */
  claim(pending: P): Promise<{ claimed: boolean; ledgerId: number | null }>;
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
  oldestUnnotifiedEventAgeHours: number | null;
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
      const { claimed, ledgerId } = await store.claim(item.pending);
      if (!claimed || ledgerId === null) {
        report.skippedDuplicate += 1;
        continue;
      }
      const outcome = await attemptSend(store, send, ledgerId, item.email, item.content, 0);
      if (outcome === "sent") report.sent += 1;
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
): Promise<"sent" | "failed"> {
  try {
    const result = await send(email, content);
    if (result.ok) {
      await store.markSent(ledgerId, result.id);
      return "sent";
    }
    // Permanent rejections jump straight to the cap: dead row, never retried.
    const attemptsAfter = result.permanent ? MAX_SEND_ATTEMPTS : priorAttempts + 1;
    await store.markFailed(ledgerId, `${result.status}: ${result.error}`, attemptsAfter);
    return "failed";
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected send error";
    await store.markFailed(ledgerId, message, priorAttempts + 1);
    return "failed";
  }
}
