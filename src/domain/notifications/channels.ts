/**
 * The notification kind catalog and the channel-preference rule. Pure. Every
 * kind the drains can decide is listed here with its human label and its default
 * email behaviour; preferences (per user, per kind, per channel, optionally per
 * workspace) override the default. An unknown kind resolves to "on" so a newly
 * added kind can never be muted by omission.
 */

export type NotificationChannel = "email" | "teams" | "push";
export type PreferenceMode = "immediate" | "off";

export interface NotificationKindMeta {
  label: string;
  /** Which settings group the kind is shown under. */
  group: "sop" | "workspace" | "digest";
  /** Whether email is on for this kind when the user has said nothing. */
  defaultEmail: boolean;
}

export const NOTIFICATION_KINDS: Record<string, NotificationKindMeta> = {
  review_requested: { label: "Review requested", group: "sop", defaultEmail: true },
  final_approval_requested: { label: "Signature needed", group: "sop", defaultEmail: true },
  quality_release_requested: { label: "Ready for release", group: "sop", defaultEmail: true },
  sent_back: { label: "Sent back with remarks", group: "sop", defaultEmail: true },
  review_complete: { label: "Ready for final approval", group: "sop", defaultEmail: true },
  released: { label: "SOP released", group: "sop", defaultEmail: true },
  seat_assigned: { label: "Review seat assigned to you", group: "sop", defaultEmail: true },
  objection_raised: { label: "Objection raised", group: "sop", defaultEmail: true },
  objection_resolved: { label: "Objection resolved", group: "sop", defaultEmail: true },
  remark_added: { label: "Remark added", group: "sop", defaultEmail: false },
  stall_escalated: { label: "Stalled SOP escalated to you", group: "sop", defaultEmail: true },
  workspace_welcome: { label: "Welcome to a workspace", group: "workspace", defaultEmail: true },
  invite_accepted: { label: "Your invitation was accepted", group: "workspace", defaultEmail: true },
  role_changed: { label: "Your role changed", group: "workspace", defaultEmail: true },
  member_removed: { label: "Removed from a workspace", group: "workspace", defaultEmail: true },
  stalled_weekly: { label: "Weekly stalled-work digest", group: "digest", defaultEmail: true },
};

export function kindLabel(kind: string): string {
  return NOTIFICATION_KINDS[kind]?.label ?? kind.replaceAll("_", " ");
}

export interface PreferenceRow {
  /** '' means "every workspace"; a workspace id scopes the row to that workspace. */
  workspaceId: string;
  kind: string;
  channel: NotificationChannel | string;
  mode: PreferenceMode | string;
}

/**
 * Channel resolution: a workspace-scoped preference beats a global one, which
 * beats the fallback. Rows for other kinds or channels are ignored.
 */
export function resolveChannelEnabled(
  kind: string,
  channel: NotificationChannel,
  workspaceId: string | null,
  preferences: readonly PreferenceRow[],
  fallback: boolean,
): boolean {
  const relevant = preferences.filter((row) => row.kind === kind && row.channel === channel);
  const scoped = workspaceId ? relevant.find((row) => row.workspaceId === workspaceId) : undefined;
  const global = relevant.find((row) => row.workspaceId === "");
  const winner = scoped ?? global;
  if (!winner) return fallback;
  return winner.mode !== "off";
}

export function resolveEmailEnabled(kind: string, workspaceId: string | null, preferences: readonly PreferenceRow[]): boolean {
  const fallback = NOTIFICATION_KINDS[kind]?.defaultEmail ?? true;
  return resolveChannelEnabled(kind, "email", workspaceId, preferences, fallback);
}
