/**
 * Invitation delivery helpers shared by the admin invite route and the author-nomination route.
 * Service-role only: `admin` must be a service-role client. `sendInvitationViaResend` is the full
 * Resend path (mint link → render → deliver → ledger) both routes call; each route keeps only its
 * own sender construction and its own mapping from `ResendInviteOutcome` to an HTTP response.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SopEmailContent } from "@/domain/sop/notifications";
import {
  inviteeHasCompletedSetup,
  isAlreadyRegisteredAuthError,
  qualityModuleInviteRedirect,
  workspaceInviteAcceptanceUrl,
  type WorkspaceInviteVerificationType,
} from "@/domain/workspace/invite";
import { renderWorkspaceAccessGrantedEmail, renderWorkspaceInviteEmail } from "@/domain/workspace/invite-email";
import type { Database } from "@/lib/database.types";
import { recordTransactionalEmail, type TransactionalEmailKind } from "@/lib/notifications/transactional-log";
import type { EmailSender } from "@/lib/sop/notifications-drain";

export type SetupLink =
  | { kind: "link"; tokenHash: string; type: WorkspaceInviteVerificationType; userId: string | null }
  | { kind: "already_registered"; userId: string | null }
  | { kind: "unavailable"; message: string; code: string | null; status: number | null };

export async function countWorkspaceMemberships(admin: SupabaseClient<Database>, userId: string | undefined): Promise<number> {
  if (!userId) return 0;
  const { count, error } = await admin
    .from("workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) {
    // Unknown is treated as "not set up": a setup link is the safe default, since
    // it only takes effect if the invitee clicks it and chooses a password.
    console.error("Invite resend: membership lookup failed", { message: error.message });
    return 0;
  }
  return count ?? 0;
}

/**
 * Mint the one-time token behind the "create your password" link.
 *
 * The first invite creates the auth user, so a second call to generateLink(type: "invite") —
 * which is what every RESEND is — comes back "already registered". For an existing user we mint
 * a recovery token instead, which the /invite page already knows how to verify — unless they
 * already belong to a workspace, in which case they own a password and get a reminder, not a
 * credential.
 */
export async function generateSetupLink(
  admin: SupabaseClient<Database>,
  email: string,
  redirectTo: string,
): Promise<SetupLink> {
  const invite = await admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo } });
  if (!invite.error && invite.data.properties?.hashed_token) {
    return { kind: "link", tokenHash: invite.data.properties.hashed_token, type: "invite", userId: invite.data.user?.id ?? null };
  }
  if (!invite.error || !isAlreadyRegisteredAuthError(invite.error)) {
    return {
      kind: "unavailable",
      message: invite.error?.message ?? "Supabase returned no invitation token.",
      code: invite.error?.code ?? null,
      status: invite.error?.status ?? null,
    };
  }

  const recovery = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
  if (recovery.error || !recovery.data.properties?.hashed_token) {
    return {
      kind: "unavailable",
      message: recovery.error?.message ?? "Supabase returned no recovery token.",
      code: recovery.error?.code ?? null,
      status: recovery.error?.status ?? null,
    };
  }
  const userId = recovery.data.user?.id ?? null;
  const workspaceMemberships = await countWorkspaceMemberships(admin, userId ?? undefined);
  if (inviteeHasCompletedSetup({ workspaceMemberships })) {
    return { kind: "already_registered", userId };
  }
  return { kind: "link", tokenHash: recovery.data.properties.hashed_token, type: "recovery", userId };
}

export interface DeliveryRecord {
  admin: SupabaseClient<Database>;
  kind: TransactionalEmailKind;
  workspaceId: string;
}

/** Send one email and record the outcome in the transactional ledger, logging (never throwing) on failure. */
export async function deliverInvitationEmail(
  send: EmailSender,
  to: string,
  content: SopEmailContent,
  record: DeliveryRecord,
): Promise<boolean> {
  try {
    // Every click is a deliberate (re)send, so the key is per request: it guards the provider
    // retry inside this call, never a later resend.
    const result = await send(to, content, { idempotencyKey: `invite:${randomUUID()}` });
    await recordTransactionalEmail(record.admin, {
      kind: record.kind,
      recipientEmail: to,
      workspaceId: record.workspaceId,
      result,
    });
    if (result.ok) return true;
    console.error("Invitation email delivery failed", { status: result.status, failure: result.failure });
  } catch (error) {
    console.error("Invitation email delivery threw", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return false;
}

/** Where an invitation link should land: the configured site (production) or, failing that, the request's origin. */
export function inviteRedirectTarget(requestUrl: string): string {
  const configuredSiteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined);
  return qualityModuleInviteRedirect(requestUrl, configuredSiteUrl);
}

export type ResendInviteOutcome =
  | { kind: "sent"; userId: string | null } // setup/recovery link email delivered
  | { kind: "send_failed"; userId: string | null } // link minted, provider refused (ledger row recorded by deliverInvitationEmail)
  | { kind: "already_registered"; delivered: boolean; userId: string | null } // access-granted reminder attempted instead of a credential
  | { kind: "unavailable"; message: string; code: string | null; status: number | null }; // no link could be minted; a failed `invite` ledger row IS recorded here

export interface ResendInviteInput {
  email: string;
  redirectTo: string;
  accessSummary: readonly string[];
  organizationName: string;
  workspaceId: string;
}

/**
 * The Resend path of a workspace invitation: mint the one-time link, render the right email
 * (setup link, or an access-granted reminder for someone who already finished setup), deliver it,
 * and record the outcome in the transactional ledger. Callers build their own HTTP response from
 * the outcome; the Supabase-mail fallback stays with the caller.
 */
export async function sendInvitationViaResend(
  admin: SupabaseClient<Database>,
  send: EmailSender,
  input: ResendInviteInput,
): Promise<ResendInviteOutcome> {
  const setupLink = await generateSetupLink(admin, input.email, input.redirectTo);
  const origin = new URL(input.redirectTo).origin;

  if (setupLink.kind === "link") {
    const delivered = await deliverInvitationEmail(
      send,
      input.email,
      renderWorkspaceInviteEmail({
        actionLink: workspaceInviteAcceptanceUrl(input.redirectTo, input.email, setupLink.tokenHash, setupLink.type),
        accessSummary: input.accessSummary,
        email: input.email,
        organizationName: input.organizationName,
        origin,
      }),
      { admin, kind: "invite", workspaceId: input.workspaceId },
    );
    return delivered ? { kind: "sent", userId: setupLink.userId } : { kind: "send_failed", userId: setupLink.userId };
  }

  if (setupLink.kind === "already_registered") {
    const delivered = await deliverInvitationEmail(
      send,
      input.email,
      renderWorkspaceAccessGrantedEmail({
        accessSummary: input.accessSummary,
        email: input.email,
        organizationName: input.organizationName,
        origin,
        signInLink: new URL("/", origin).toString(),
      }),
      { admin, kind: "access_granted", workspaceId: input.workspaceId },
    );
    return { kind: "already_registered", delivered, userId: setupLink.userId };
  }

  console.error("Invitation link generation failed", {
    message: setupLink.message,
    code: setupLink.code,
    status: setupLink.status,
  });
  await recordTransactionalEmail(admin, {
    kind: "invite",
    recipientEmail: input.email,
    workspaceId: input.workspaceId,
    result: {
      ok: false,
      status: setupLink.status ?? 0,
      error: `generate_link: ${setupLink.code ?? setupLink.message}`,
      failure: "configuration",
    },
  });
  return { kind: "unavailable", message: setupLink.message, code: setupLink.code, status: setupLink.status };
}
