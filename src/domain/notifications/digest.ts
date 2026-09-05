/**
 * Weekly stalled-work digest decisions and template. Pure. One digest per
 * owner/admin and Quality approver per workspace per ISO week, listing every
 * in-flight SOP that has not moved for STALL_DIGEST_DAYS and what it waits on.
 */

import { escapeHtml, renderEmailShell, type EmailContent } from "@/domain/notification-email-shell";

/** In-flight SOPs untouched for this long appear in the digest. */
export const STALL_DIGEST_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** "2026-W36" — the ISO week containing `date`, used as the once-per-week claim key. */
export function isoWeekKey(date: Date): string {
  const probe = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // ISO weeks start Monday; shift to the Thursday of this week so the year is the week's year.
  const weekday = probe.getUTCDay() || 7;
  probe.setUTCDate(probe.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(probe.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((probe.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${probe.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export interface DigestSop {
  sopId: string;
  /** Render-ready label, e.g. "PRD · Line Clearance". */
  label: string;
  status: string;
  lastMovedAt: string;
  waitingOn: string;
}

export interface StalledSop extends DigestSop {
  days: number;
}

const IN_FLIGHT = new Set(["in_review", "approved"]);

export function selectStalledSops(now: Date, sops: readonly DigestSop[]): StalledSop[] {
  return sops
    .filter((sop) => IN_FLIGHT.has(sop.status))
    .map((sop) => ({ ...sop, days: Math.floor((now.getTime() - new Date(sop.lastMovedAt).getTime()) / DAY_MS) }))
    .filter((sop) => sop.days >= STALL_DIGEST_DAYS)
    .sort((a, b) => b.days - a.days);
}

export interface DigestWorkspaceState {
  workspaceId: string;
  workspaceName: string;
  /** Owners, admins, and Quality approvers — duplicates tolerated. */
  recipients: readonly string[];
  stalled: readonly StalledSop[];
}

export interface DigestPending {
  recipientId: string;
  kind: "stalled_weekly";
  workspaceId: string;
  periodKey: string;
}

export function buildStalledDigest(now: Date, workspaces: readonly DigestWorkspaceState[]): DigestPending[] {
  const periodKey = isoWeekKey(now);
  return workspaces.flatMap((workspace) => {
    if (workspace.stalled.length === 0) return [];
    return Array.from(new Set(workspace.recipients)).map((recipientId) => ({
      recipientId,
      kind: "stalled_weekly" as const,
      workspaceId: workspace.workspaceId,
      periodKey,
    }));
  });
}

export interface StalledDigestInput {
  workspaceName: string;
  periodKey: string;
  stalled: readonly StalledSop[];
  origin: string;
}

export function renderStalledDigestEmail(input: StalledDigestInput): EmailContent {
  const count = input.stalled.length;
  const subject = `Stalled SOP work this week: ${count} SOP${count === 1 ? "" : "s"} in ${input.workspaceName}`;
  const intro = `${count === 1 ? "One SOP has" : `${count} SOPs have`} stalled in ${input.workspaceName} — nothing has moved on ${count === 1 ? "it" : "them"} for ${STALL_DIGEST_DAYS} days or more.`;
  const reason = "You are receiving this because you are an owner or admin, or a Quality approver, in this workspace.";
  const lines = input.stalled.map((sop) => `${sop.label} — ${sop.days} days, waiting on ${sop.waitingOn}`);
  const link = `${input.origin}/sops/review`;

  const listHtml =
    `<ul style="margin:0 0 12px;padding-left:18px;font-size:14px;line-height:1.6;color:#3f3f46;">` +
    input.stalled
      .map(
        (sop) =>
          `<li style="margin:0 0 8px;"><a href="${input.origin}/sops/${encodeURIComponent(sop.sopId)}" style="color:#111111;font-weight:600;text-decoration:none;">${escapeHtml(sop.label)}</a>` +
          `<br><span style="color:#71717a;">${sop.days} days · waiting on ${escapeHtml(sop.waitingOn)}</span></li>`,
      )
      .join("") +
    `</ul>`;

  const html = renderEmailShell({
    accent: "#b45309",
    subtitle: "SOP document control",
    eyebrow: `Weekly digest · ${input.periodKey}`,
    heading: subject,
    bodyParagraphsHtml:
      `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3f3f46;">${escapeHtml(intro)}</p>` + listHtml,
    ctaLabel: "Open the review queue",
    ctaHref: link,
    reason,
    origin: input.origin,
  });

  return {
    subject,
    text: [intro, ...lines, `Open the review queue: ${link}`, "—", reason, input.origin].join("\n\n"),
    html,
  };
}
