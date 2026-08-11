/**
 * Workspace welcome decisions — parse the audit_log outbox row, decide whether
 * a welcome is still due, render the email. Pure: no Supabase, no clocks. The
 * drain's welcome store assembles plain-value context; these functions only
 * decide. audit_log's trigger writes the fact transactionally with EVERY
 * membership insert (invite redemption, domain auto-join, manual add), so no
 * add path can be missed.
 * Spec: docs/superpowers/specs/2026-07-22-workspace-welcome-email-design.md
 */

import { escapeHtml, renderEmailShell } from "@/domain/notification-email-shell";
import type { SopEmailContent } from "@/domain/sop/notifications";

const MEMBER_INSERT_ACTION = "workspace_members.insert";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WELCOME_ACCENT = "#0891b2";

export interface MemberAddedEvent {
  id: number;
  workspaceId: string;
  recipientId: string;
  actorId: string | null;
  createdAt: string;
}

/**
 * audit_log.target_id is "user id or email when the row has one" — for
 * workspace_members rows it is the member's uuid. The uuid check screens out
 * any email-shaped target defensively; unparseable rows resolve to null.
 */
export function parseMemberAddedEvent(row: {
  id: number;
  action: string;
  workspace_id: string | null;
  target_id: string | null;
  actor_id: string | null;
  created_at: string;
}): MemberAddedEvent | null {
  if (row.action !== MEMBER_INSERT_ACTION) return null;
  if (!row.workspace_id) return null;
  if (!row.target_id || !UUID_PATTERN.test(row.target_id)) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    recipientId: row.target_id,
    actorId: row.actor_id,
    createdAt: row.created_at,
  };
}

export interface WorkspaceWelcomeContext {
  /** Recipient is still in workspace_members for this workspace at drain time. */
  isStillMember: boolean;
  /** A dedicated invitation email already covered this membership event. */
  wasInvited: boolean;
  /** Null when the workspace no longer exists. */
  workspaceName: string | null;
  actorName: string | null;
}

export interface WorkspaceWelcomePending {
  recipientId: string;
  kind: "workspace_welcome";
  workspaceId: string;
  eventId: number;
}

/** Skip stale memberships and invite redemptions that already received the invitation email. */
export function resolveWorkspaceWelcome(
  event: MemberAddedEvent,
  ctx: WorkspaceWelcomeContext,
): WorkspaceWelcomePending | null {
  if (!ctx.isStillMember || ctx.wasInvited || !ctx.workspaceName) return null;
  return {
    recipientId: event.recipientId,
    kind: "workspace_welcome",
    workspaceId: event.workspaceId,
    eventId: event.id,
  };
}

export function renderWorkspaceWelcomeEmail(input: {
  workspaceName: string;
  actorName: string | null;
  /** actor_id was null or equal to the recipient — an auto-join. */
  selfCaused: boolean;
  origin: string;
}): SopEmailContent {
  const happened = input.selfCaused
    ? `You joined ${input.workspaceName} via your company email domain.`
    : input.actorName
      ? `${input.actorName} added you to ${input.workspaceName}.`
      : `You were added to ${input.workspaceName}.`;
  const what = `Pulse is where this team plans production, controls SOP documents, and tracks review work.`;
  const reason = "You are receiving this because you were added to this workspace.";
  const link = `${input.origin}/`;

  const paragraph = (line: string): string =>
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3f3f46;">${escapeHtml(line)}</p>`;

  return {
    subject: `Welcome to ${input.workspaceName} on Pulse`,
    text: [happened, what, `Open it: ${link}`, "—", reason, input.origin].join("\n\n"),
    html: renderEmailShell({
      accent: WELCOME_ACCENT,
      subtitle: "Company workspace",
      eyebrow: "Welcome",
      heading: `Welcome to ${input.workspaceName}`,
      bodyParagraphsHtml: paragraph(happened) + paragraph(what),
      ctaLabel: "Open Pulse",
      ctaHref: link,
      reason,
      origin: input.origin,
    }),
  };
}
