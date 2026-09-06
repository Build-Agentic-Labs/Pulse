import type { AccessLevel, WorkspaceRole } from "@/domain/types";

export type WorkspaceInviteVerificationType = "invite" | "recovery";

export interface WorkspaceInviteAcceptance {
  email: string;
  tokenHash: string;
  type: WorkspaceInviteVerificationType;
}

export function qualityModuleAccessForRole(role: WorkspaceRole): AccessLevel {
  return role === "viewer" ? "view" : "edit";
}

export function qualityModuleAccessLabel(level: AccessLevel): string {
  if (level === "view") return "Viewer";
  if (level === "edit") return "Editor";
  return "No access";
}

export function qualityModuleInviteRedirect(requestUrl: string, configuredSiteUrl?: string): string {
  if (configuredSiteUrl) {
    try {
      return new URL("/?invite=1", configuredSiteUrl).toString();
    } catch {
      // Fall through to the request origin for an invalid deployment setting.
    }
  }
  return new URL("/?invite=1", requestUrl).toString();
}

/**
 * Keep the Supabase credential in the fragment: mail scanners may request the
 * Pulse page, but fragments are not sent to the web server. Pulse verifies the
 * token only after the recipient submits their new password.
 */
export function workspaceInviteAcceptanceUrl(
  siteUrl: string,
  email: string,
  tokenHash: string,
  type: WorkspaceInviteVerificationType = "invite",
): string {
  const url = new URL("/invite", siteUrl);
  url.hash = new URLSearchParams({
    email: email.trim().toLowerCase(),
    token_hash: tokenHash,
    type,
  }).toString();
  return url.toString();
}

export function parseWorkspaceInviteAcceptanceHash(hash: string): WorkspaceInviteAcceptance | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const email = params.get("email")?.trim().toLowerCase() ?? "";
  const tokenHash = params.get("token_hash")?.trim() ?? "";
  const rawType = params.get("type");
  const type = rawType === "invite" || rawType === "recovery" ? rawType : null;

  if (!email || !email.includes("@") || !tokenHash || !type) {
    return null;
  }

  return { email, tokenHash, type };
}

/**
 * Supabase (GoTrue) rejects invite generation for an email that already has an
 * auth user. After the FIRST invite that is every invitee, so a resend must
 * recognise this and fall back to a recovery-type setup link.
 */
export function isAlreadyRegisteredAuthError(
  error: { message?: string; code?: string } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === "email_exists") return true;
  return /already.*(registered|exists|been invited)/i.test(error.message ?? "");
}

/**
 * Has this invitee actually finished setting up — i.e. joined a workspace? Only
 * then is a resend a "sign-in reminder" rather than a fresh setup link.
 *
 * Membership is the evidence, NOT `last_sign_in_at`: on 2026-08-12 a mail
 * scanner opened eleven invite links within two minutes of delivery, which
 * verified the tokens and stamped a sign-in on accounts whose owners never saw
 * Pulse. Keying on sign-in left all eleven stuck as "already registered".
 */
export function inviteeHasCompletedSetup(
  invitee: { workspaceMemberships?: number | null } | null | undefined,
): boolean {
  return (invitee?.workspaceMemberships ?? 0) > 0;
}

export interface AccessGrantPartition<G> {
  /** Unredeemed grants for people who are not members yet — the Pending invitations list. */
  pendingInvites: G[];
  /** Unredeemed grants for CURRENT members, keyed by lower-cased email — access changes awaiting their next sign-in. */
  accessUpdatesByEmail: Map<string, G>;
}

/**
 * Re-inviting an existing member resets their grant to unredeemed on purpose:
 * `redeem_workspace_access_grants()` applies only unredeemed grants, so that is
 * how changed entitlements reach them at next sign-in. The Members panel must
 * therefore not list such a grant as a second, pending person — it belongs on the
 * member's own row as a pending access update.
 */
export function partitionAccessGrants<G extends { email: string; redeemedAt?: string | null }>(
  grants: readonly G[],
  memberEmails: Iterable<string | null | undefined>,
): AccessGrantPartition<G> {
  const members = new Set<string>();
  for (const email of memberEmails) {
    if (email) members.add(email.trim().toLowerCase());
  }
  const pendingInvites: G[] = [];
  const accessUpdatesByEmail = new Map<string, G>();
  for (const grant of grants) {
    if (grant.redeemedAt) continue;
    const email = grant.email.trim().toLowerCase();
    if (members.has(email)) accessUpdatesByEmail.set(email, grant);
    else pendingInvites.push(grant);
  }
  return { pendingInvites, accessUpdatesByEmail };
}
