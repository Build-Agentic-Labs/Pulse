/**
 * Invitation delivery helpers shared by the admin invite route and the author-nomination route.
 * Service-role only: `admin` must be a service-role client. Moved verbatim from
 * app/api/invites/route.ts (2026-09-10) with one addition — the setup link carries the auth user
 * id so a caller can mint a provisional membership for a freshly created invitee.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SopEmailContent } from "@/domain/sop/notifications";
import {
  inviteeHasCompletedSetup,
  isAlreadyRegisteredAuthError,
  type WorkspaceInviteVerificationType,
} from "@/domain/workspace/invite";
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
