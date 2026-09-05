/**
 * Membership notifications — decisions and templates for role changes,
 * removals, and accepted invitations. audit_log is the outbox (its trigger
 * snapshots old/new rows on every workspace_members and workspace_access_grants
 * change). Pure: no Supabase, no clocks. Welcome (insert) decisions live in
 * ./welcome.ts; this module handles the other three actions.
 */

import { escapeHtml, renderEmailShell, type EmailContent } from "@/domain/notification-email-shell";

export const MEMBERSHIP_NOTIFIABLE_ACTIONS = [
  "workspace_members.insert",
  "workspace_members.update",
  "workspace_members.delete",
  "workspace_access_grants.update",
] as const;

export type MembershipKind = "role_changed" | "member_removed" | "invite_accepted";

export interface MembershipEvent {
  id: number;
  kind: MembershipKind;
  workspaceId: string;
  recipientId: string;
  actorId: string | null;
  createdAt: string;
  role?: string;
  previousRole?: string;
  inviteeEmail?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function str(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === "string" ? (record[key] as string) : null;
}

export function parseMembershipEvent(row: {
  id: number;
  action: string;
  workspace_id: string | null;
  target_id: string | null;
  actor_id: string | null;
  details: unknown;
  created_at: string;
}): MembershipEvent | null {
  if (!row.workspace_id) return null;
  const details = asRecord(row.details);
  const previous = asRecord(details.old);
  const next = asRecord(details.new);
  const base = { id: row.id, workspaceId: row.workspace_id, actorId: row.actor_id, createdAt: row.created_at };

  switch (row.action) {
    case "workspace_members.update": {
      if (!row.target_id || !UUID_PATTERN.test(row.target_id)) return null;
      const role = str(next, "role");
      const previousRole = str(previous, "role");
      if (!role || role === previousRole) return null;
      return { ...base, kind: "role_changed", recipientId: row.target_id, role, previousRole: previousRole ?? undefined };
    }
    case "workspace_members.delete": {
      if (!row.target_id || !UUID_PATTERN.test(row.target_id)) return null;
      return { ...base, kind: "member_removed", recipientId: row.target_id };
    }
    case "workspace_access_grants.update": {
      // A redemption is the update that sets redeemed_at where it was null.
      if (!str(next, "redeemed_at") || str(previous, "redeemed_at")) return null;
      const inviter = str(next, "granted_by");
      const redeemer = str(next, "redeemed_by") ?? row.actor_id;
      if (!inviter || !UUID_PATTERN.test(inviter) || inviter === redeemer) return null;
      const inviteeEmail = str(next, "email") ?? str(previous, "email") ?? undefined;
      return { ...base, kind: "invite_accepted", recipientId: inviter, actorId: redeemer, createdAt: row.created_at, inviteeEmail };
    }
    default:
      return null;
  }
}

export interface MembershipContext {
  /** The recipient is in workspace_members for this workspace at drain time. */
  recipientIsMember: boolean;
  /** Null when the workspace no longer exists. */
  workspaceName: string | null;
}

export interface MembershipPending {
  recipientId: string;
  kind: MembershipKind;
  workspaceId: string;
  eventId: number;
}

/** Skip-unless-now: a role change to someone since removed, or a removal since reversed, is stale. */
export function resolveMembershipNotification(event: MembershipEvent, ctx: MembershipContext): MembershipPending | null {
  if (!ctx.workspaceName) return null;
  if (event.kind === "member_removed" ? ctx.recipientIsMember : !ctx.recipientIsMember) return null;
  return { recipientId: event.recipientId, kind: event.kind, workspaceId: event.workspaceId, eventId: event.id };
}

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export interface MembershipEmailInput {
  kind: MembershipKind;
  workspaceName: string;
  actorName: string | null;
  origin: string;
  role?: string;
  inviteeEmail?: string;
}

export function renderMembershipEmail(input: MembershipEmailInput): EmailContent {
  const actor = input.actorName ?? "An administrator";
  const link = `${input.origin}/`;
  let subject: string;
  let eyebrow: string;
  let accent: string;
  let happened: string;
  let needed: string;
  let reason: string;
  switch (input.kind) {
    case "role_changed": {
      const role = roleLabel(input.role ?? "member");
      subject = `Your role in ${input.workspaceName} changed to ${role}`;
      eyebrow = "Role changed";
      accent = "#2563eb";
      happened = `${actor} changed your role in ${input.workspaceName} to ${role}.`;
      needed = `Your access applies the next time the app loads.`;
      reason = "You are receiving this because your membership in this workspace changed.";
      break;
    }
    case "member_removed":
      subject = `You were removed from ${input.workspaceName}`;
      eyebrow = "Access removed";
      accent = "#dc2626";
      happened = `${actor} removed you from ${input.workspaceName}.`;
      needed = `If this was unexpected, contact a workspace administrator.`;
      reason = "You are receiving this because your membership in this workspace changed.";
      break;
    case "invite_accepted":
      subject = `${input.inviteeEmail ?? "Someone"} accepted your invitation to ${input.workspaceName}`;
      eyebrow = "Invitation accepted";
      accent = "#059669";
      happened = `${input.inviteeEmail ?? "Someone you invited"} accepted your invitation and joined ${input.workspaceName}.`;
      needed = `They have the access you granted; you can adjust it under Settings → Organization.`;
      reason = "You are receiving this because you sent this invitation.";
      break;
  }
  const paragraph = (line: string): string =>
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3f3f46;">${escapeHtml(line)}</p>`;
  return {
    subject,
    text: [happened, needed, `Open Pulse: ${link}`, "—", reason, input.origin].join("\n\n"),
    html: renderEmailShell({
      accent,
      subtitle: "Company workspace",
      eyebrow,
      heading: subject,
      bodyParagraphsHtml: paragraph(happened) + paragraph(needed),
      ctaLabel: "Open Pulse",
      ctaHref: link,
      reason,
      origin: input.origin,
    }),
  };
}
