import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { renderWorkspaceAccessGrantedEmail, renderWorkspaceInviteEmail } from "@/domain/workspace/invite-email";
import { createApiRateLimiter, requireApiUser } from "@/lib/api-auth";
import type { Database, Json } from "@/lib/database.types";
import type { SopEmailContent } from "@/domain/sop/notifications";
import { isAllowedSignupEmail, SIGNUP_DOMAIN_MESSAGE } from "@/lib/allowed-signup-domain";
import {
  inviteeHasCompletedSetup,
  isAlreadyRegisteredAuthError,
  qualityModuleInviteRedirect,
  workspaceInviteAcceptanceUrl,
  type WorkspaceInviteVerificationType,
} from "@/domain/workspace/invite";
import {
  describeInviteEntitlements,
  normalizedInviteEntitlements,
  workspaceRoleForOrganizationRole,
  type InviteAccessPackage,
  type InviteDepartmentAccess,
  type InviteProjectAccess,
  type OrganizationInviteRole,
  type WorkspaceInviteEntitlements,
} from "@/domain/workspace/invite-access";
import { describeUnavailable, logMissingConfig } from "@/lib/auth/password-recovery-request";
import { createEmailSenderFromEnv } from "@/lib/notifications/sender-from-env";
import { recordTransactionalEmail, type TransactionalEmailKind } from "@/lib/notifications/transactional-log";
import { createResendSender, type EmailSender } from "@/lib/sop/notifications-drain";
import { normalizeJobTitle } from "@/domain/departments";

export const dynamic = "force-dynamic";

const ORGANIZATION_ROLES = ["member", "admin"] as const;
const ACCESS_PACKAGES = ["custom", "industrial_engineer", "quality_reviewer", "planner", "production_operator"] as const;
const ACCESS_LEVELS = ["none", "view", "edit"] as const;
const DEPARTMENT_ROLES = ["author", "reviewer", "approver"] as const;

const checkRateLimit = createApiRateLimiter({ windowMs: 60_000, maxRequests: 20 });

// Days until an unredeemed invite expires — mirrors the workspace_access_grants
// column default (20260703120000 migration).
const GRANT_EXPIRY_DAYS = 30;

type SetupLink =
  | { kind: "link"; tokenHash: string; type: WorkspaceInviteVerificationType }
  | { kind: "already_registered" }
  | { kind: "unavailable"; message: string; code: string | null; status: number | null };

/**
 * Mint the one-time token behind the "create your password" link.
 *
 * The first invite creates the auth user, so a second call to
 * generateLink(type: "invite") — which is what every RESEND is — comes back
 * "already registered" and, before this helper existed, silently sent nothing.
 * For an existing user we mint a recovery token instead, which the /invite page
 * already knows how to verify — unless they already belong to a workspace, in
 * which case they own a password and get a reminder, not a credential.
 */
async function countWorkspaceMemberships(admin: SupabaseClient<Database>, userId: string | undefined): Promise<number> {
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

async function generateSetupLink(
  admin: SupabaseClient<Database>,
  email: string,
  redirectTo: string,
): Promise<SetupLink> {
  const invite = await admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo } });
  if (!invite.error && invite.data.properties?.hashed_token) {
    return { kind: "link", tokenHash: invite.data.properties.hashed_token, type: "invite" };
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
  const workspaceMemberships = await countWorkspaceMemberships(admin, recovery.data.user?.id);
  if (inviteeHasCompletedSetup({ workspaceMemberships })) {
    return { kind: "already_registered" };
  }
  return { kind: "link", tokenHash: recovery.data.properties.hashed_token, type: "recovery" };
}

const ALREADY_REGISTERED_REASON = "They already have an account — access applies the next time they sign in.";
const ALREADY_REGISTERED_EMAILED_REASON =
  "They already have an account, so we emailed them a sign-in reminder instead of a setup link.";

interface DeliveryRecord {
  admin: SupabaseClient<Database>;
  kind: TransactionalEmailKind;
  workspaceId: string;
}

/** Send one email and record the outcome in the transactional ledger, logging (never throwing) on failure. */
async function deliver(send: EmailSender, to: string, content: SopEmailContent, record: DeliveryRecord): Promise<boolean> {
  try {
    // Every admin click is a deliberate (re)send, so the key is per request: it
    // guards the provider retry inside this call, never a later resend.
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

/**
 * Invite a user to a workspace. The grant row is written with the CALLER's token, so
 * RLS (manager role + approved-domain trigger) stays the authorization layer. The
 * service-role key is used only for the one thing RLS cannot do: sending the actual
 * invitation email via Supabase's admin API. Without the key the grant still lands and
 * the response says so, so the UI can be honest that no email went out.
 */
export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (auth.failure) {
    return auth.failure;
  }

  if (!checkRateLimit(auth.userId)) {
    return NextResponse.json({ error: "Too many invites — try again in a minute." }, { status: 429 });
  }

  let body: {
    workspaceId?: string;
    email?: string;
    organizationRole?: string;
    accessPackage?: string;
    qualityAccess?: string;
    planningAccess?: boolean;
    projectAccess?: unknown;
    departmentAccess?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const organizationRole = ORGANIZATION_ROLES.includes(body.organizationRole as OrganizationInviteRole)
    ? (body.organizationRole as OrganizationInviteRole)
    : null;
  const accessPackage = ACCESS_PACKAGES.includes(body.accessPackage as InviteAccessPackage)
    ? (body.accessPackage as InviteAccessPackage)
    : "custom";
  const qualityAccess = ACCESS_LEVELS.includes(body.qualityAccess as (typeof ACCESS_LEVELS)[number])
    ? (body.qualityAccess as WorkspaceInviteEntitlements["qualityAccess"])
    : null;
  const planningAccess = body.planningAccess === true;
  const rawProjectAccess = Array.isArray(body.projectAccess) ? body.projectAccess : [];
  const rawDepartmentAccess = Array.isArray(body.departmentAccess) ? body.departmentAccess : [];
  const projectAccess: InviteProjectAccess[] = rawProjectAccess.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const projectId = typeof row.projectId === "string" ? row.projectId.trim() : "";
    const level = row.level === "view" || row.level === "edit" ? row.level : null;
    return projectId && level ? [{ projectId, level }] : [];
  });
  const departmentAccess: InviteDepartmentAccess[] = rawDepartmentAccess.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const departmentId = typeof row.departmentId === "string" ? row.departmentId.trim() : "";
    const role = DEPARTMENT_ROLES.includes(row.role as InviteDepartmentAccess["role"])
      ? (row.role as InviteDepartmentAccess["role"])
      : null;
    const positionTitle = typeof row.positionTitle === "string" ? normalizeJobTitle(row.positionTitle) : null;
    return departmentId && role && positionTitle ? [{ departmentId, role, positionTitle }] : [];
  });

  if (!workspaceId || !email || !organizationRole || !qualityAccess) {
    return NextResponse.json(
      { error: "workspaceId, email, organizationRole, and qualityAccess are required." },
      { status: 400 },
    );
  }
  if (rawProjectAccess.length !== projectAccess.length || rawDepartmentAccess.length !== departmentAccess.length) {
    return NextResponse.json({ error: "One or more access selections are invalid." }, { status: 400 });
  }
  if (projectAccess.length > 100 || departmentAccess.length > 100) {
    return NextResponse.json({ error: "Too many access selections in one invitation." }, { status: 400 });
  }

  if (!isAllowedSignupEmail(email)) {
    return NextResponse.json({ error: SIGNUP_DOMAIN_MESSAGE }, { status: 400 });
  }

  const supabase = auth.supabase;

  // Manager check up front for a friendly error (RLS below would reject anyway).
  const { data: isManager, error: roleError } = await supabase.rpc("has_workspace_role", {
    target_workspace_id: workspaceId,
    allowed_roles: ["owner", "admin"],
  });
  if (roleError) {
    return NextResponse.json({ error: roleError.message }, { status: 500 });
  }
  if (isManager !== true) {
    return NextResponse.json({ error: "Only owners and admins can invite members." }, { status: 403 });
  }

  if (organizationRole === "admin") {
    const { data: isOwner, error: ownerError } = await supabase.rpc("has_workspace_role", {
      target_workspace_id: workspaceId,
      allowed_roles: ["owner"],
    });
    if (ownerError) {
      return NextResponse.json({ error: ownerError.message }, { status: 500 });
    }
    if (isOwner !== true) {
      return NextResponse.json({ error: "Only an owner can invite another admin." }, { status: 403 });
    }
  }

  const uniqueProjectIds = [...new Set(projectAccess.map((grant) => grant.projectId))];
  const uniqueDepartmentIds = [...new Set(departmentAccess.map((grant) => grant.departmentId))];
  if (uniqueProjectIds.length !== projectAccess.length || uniqueDepartmentIds.length !== departmentAccess.length) {
    return NextResponse.json({ error: "Each resource can only be selected once." }, { status: 400 });
  }

  const [workspaceResult, projectsResult, departmentsResult] = await Promise.all([
    supabase.from("workspaces").select("name").eq("id", workspaceId).maybeSingle(),
    uniqueProjectIds.length
      ? supabase.from("projects").select("id,name").eq("workspace_id", workspaceId).in("id", uniqueProjectIds)
      : Promise.resolve({ data: [], error: null }),
    uniqueDepartmentIds.length
      ? supabase.from("departments").select("id,name").eq("workspace_id", workspaceId).in("id", uniqueDepartmentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const lookupError = workspaceResult.error ?? projectsResult.error ?? departmentsResult.error;
  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }
  if ((projectsResult.data?.length ?? 0) !== uniqueProjectIds.length || (departmentsResult.data?.length ?? 0) !== uniqueDepartmentIds.length) {
    return NextResponse.json({ error: "A selected resource does not belong to this organization." }, { status: 400 });
  }

  const entitlements = normalizedInviteEntitlements({
    organizationRole,
    accessPackage,
    qualityAccess,
    planningAccess,
    projectAccess,
    departmentAccess,
  });

  // Lift any prior revocation so the grant can mint a membership again (managers may
  // delete revocations under RLS; ignore "table missing" pre-migration).
  const { error: revocationError } = await supabase
    .from("workspace_revocations")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("email", email);
  if (revocationError && revocationError.code !== "42P01" && revocationError.code !== "PGRST205") {
    return NextResponse.json({ error: revocationError.message }, { status: 500 });
  }

  const { error: grantError } = await supabase.from("workspace_access_grants").upsert(
    {
      workspace_id: workspaceId,
      email,
      role: workspaceRoleForOrganizationRole(entitlements.organizationRole),
      quality_access: entitlements.qualityAccess,
      access_package: entitlements.accessPackage,
      planning_access: entitlements.planningAccess,
      project_access: entitlements.projectAccess.map((grant) => ({
        project_id: grant.projectId,
        level: grant.level,
      })) as Json,
      department_access: entitlements.departmentAccess.map((grant) => ({
        department_id: grant.departmentId,
        role: grant.role,
        position_title: grant.positionTitle,
      })) as Json,
      granted_by: auth.userId,
      expires_at: new Date(Date.now() + GRANT_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      redeemed_by: null,
      redeemed_at: null,
    },
    { onConflict: "workspace_id,email" },
  );
  if (grantError) {
    const status = grantError.code === "42501" ? 403 : 500;
    return NextResponse.json({ error: grantError.message }, { status });
  }

  // Invitations use a Supabase-generated one-time action link delivered through
  // Pulse's verified Resend sender. This keeps the subject, destination, and
  // create-password wording under application control. Supabase mail remains a
  // fallback when Resend is not configured.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const resendApiKey = process.env.RESEND_API_KEY ?? "";
  const resendFrom = process.env.RESEND_FROM ?? "";

  if (!serviceRoleKey) {
    // Admin-facing, so naming the variable is useful; the log line is what the
    // operator greps for. Preview deployments lack this key by design.
    logMissingConfig("Invitations", ["SUPABASE_SERVICE_ROLE_KEY"], process.env.VERCEL_ENV);
    return NextResponse.json({
      granted: true,
      emailSent: false,
      reason: `${describeUnavailable("Invitations", process.env.VERCEL_ENV)} Missing configuration: SUPABASE_SERVICE_ROLE_KEY.`,
    });
  }

  const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const configuredSiteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined);
  const redirectTo = qualityModuleInviteRedirect(request.url, configuredSiteUrl);

  if (resendApiKey && resendFrom) {
    const setupLink = await generateSetupLink(admin, email, redirectTo);
    // Honours NOTIFICATION_EMAIL_REDIRECT_TO during a test window.
    const send = createEmailSenderFromEnv().send ?? createResendSender(resendApiKey, resendFrom);
    const projectNames = new Map((projectsResult.data ?? []).map((row) => [String(row.id), String(row.name)]));
    const departmentNames = new Map((departmentsResult.data ?? []).map((row) => [String(row.id), String(row.name)]));
    const accessSummary = describeInviteEntitlements(entitlements, projectNames, departmentNames);
    const organizationName = workspaceResult.data?.name ?? "your organization";
    const origin = new URL(redirectTo).origin;

    if (setupLink.kind === "already_registered") {
      // They finished setup before, so no credential goes out — but the admin
      // clicked Resend because this person is waiting on SOMETHING, so at least
      // tell them their access is live and where to sign in.
      const delivered = await deliver(
        send,
        email,
        renderWorkspaceAccessGrantedEmail({
          accessSummary,
          email,
          organizationName,
          origin,
          signInLink: new URL("/", origin).toString(),
        }),
        { admin, kind: "access_granted", workspaceId },
      );
      return NextResponse.json({
        granted: true,
        emailSent: delivered,
        alreadyRegistered: true,
        reason: delivered ? ALREADY_REGISTERED_EMAILED_REASON : ALREADY_REGISTERED_REASON,
      });
    }

    if (setupLink.kind === "link") {
      const delivered = await deliver(
        send,
        email,
        renderWorkspaceInviteEmail({
          actionLink: workspaceInviteAcceptanceUrl(redirectTo, email, setupLink.tokenHash, setupLink.type),
          accessSummary,
          email,
          organizationName,
          origin,
        }),
        { admin, kind: "invite", workspaceId },
      );
      if (delivered) {
        return NextResponse.json({ granted: true, emailSent: true });
      }
      return NextResponse.json({
        granted: true,
        emailSent: false,
        reason: "The invitation email could not be sent. Try Resend again.",
      });
    }

    console.error("Invitation link generation failed", { message: setupLink.message, code: setupLink.code, status: setupLink.status });
    // No email exists yet, but the console must still see that this invite hit a wall.
    await recordTransactionalEmail(admin, {
      kind: "invite",
      recipientEmail: email,
      workspaceId,
      result: {
        ok: false,
        status: setupLink.status ?? 0,
        error: `generate_link: ${setupLink.code ?? setupLink.message}`,
        failure: "configuration",
      },
    });
  }

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });

  if (!inviteError) {
    return NextResponse.json({ granted: true, emailSent: true });
  }

  if (!isAlreadyRegisteredAuthError(inviteError)) {
    return NextResponse.json({ granted: true, emailSent: false, reason: inviteError.message });
  }

  // Supabase-mail resend: the user row exists from the first invite. Send a
  // recovery email (same redirect, same password-setup flow) unless they already
  // belong to a workspace.
  const { data: existing } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });
  const existingMemberships = existing?.user ? await countWorkspaceMemberships(admin, existing.user.id) : 0;
  if (existing?.user && !inviteeHasCompletedSetup({ workspaceMemberships: existingMemberships })) {
    const { error: recoverError } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
    if (!recoverError) {
      return NextResponse.json({ granted: true, emailSent: true });
    }
    return NextResponse.json({ granted: true, emailSent: false, reason: recoverError.message });
  }

  return NextResponse.json({
    granted: true,
    emailSent: false,
    alreadyRegistered: true,
    reason: ALREADY_REGISTERED_REASON,
  });
}
