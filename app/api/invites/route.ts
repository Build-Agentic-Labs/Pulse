import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { renderQualityModuleInviteEmail } from "@/domain/workspace/invite-email";
import { callerScopedSupabase, createApiRateLimiter, getBearerToken, requireApiUser } from "@/lib/api-auth";
import type { Database } from "@/lib/database.types";
import { isAllowedSignupEmail, SIGNUP_DOMAIN_MESSAGE } from "@/lib/allowed-signup-domain";
import {
  qualityModuleAccessForRole,
  qualityModuleAccessLabel,
  qualityModuleInviteRedirect,
} from "@/domain/workspace/invite";
import { createResendSender } from "@/lib/sop/notifications-drain";

export const dynamic = "force-dynamic";

const WORKSPACE_ROLES = ["owner", "admin", "editor", "viewer"] as const;
type InviteRole = (typeof WORKSPACE_ROLES)[number];

const checkRateLimit = createApiRateLimiter({ windowMs: 60_000, maxRequests: 20 });

// Days until an unredeemed invite expires — mirrors the workspace_access_grants
// column default (20260703120000 migration).
const GRANT_EXPIRY_DAYS = 30;

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

  let body: { workspaceId?: string; email?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = WORKSPACE_ROLES.includes(body.role as InviteRole) ? (body.role as InviteRole) : null;

  if (!workspaceId || !email || !role) {
    return NextResponse.json({ error: "workspaceId, email, and role are required." }, { status: 400 });
  }

  if (!isAllowedSignupEmail(email)) {
    return NextResponse.json({ error: SIGNUP_DOMAIN_MESSAGE }, { status: 400 });
  }

  const supabase = callerScopedSupabase(getBearerToken(request));

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

  const qualityAccess = qualityModuleAccessForRole(role);
  const { error: grantError } = await supabase.from("workspace_access_grants").upsert(
    {
      workspace_id: workspaceId,
      email,
      role,
      quality_access: qualityAccess,
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

  // First-time invitations use a Supabase-generated one-time action link delivered
  // through Pulse's verified Resend sender. This keeps the subject, destination,
  // and create-password wording under application control. Supabase mail remains a
  // fallback when Resend is not configured.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const resendApiKey = process.env.RESEND_API_KEY ?? "";
  const resendFrom = process.env.RESEND_FROM ?? "";

  if (!serviceRoleKey) {
    return NextResponse.json({
      granted: true,
      emailSent: false,
      reason: "Email service is not configured (SUPABASE_SERVICE_ROLE_KEY missing).",
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
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: { redirectTo },
    });

    if (!linkError && linkData.properties?.action_link) {
      try {
        const send = createResendSender(resendApiKey, resendFrom);
        const result = await send(
          email,
          renderQualityModuleInviteEmail({
            actionLink: linkData.properties.action_link,
            accessLabel: qualityModuleAccessLabel(qualityAccess),
            email,
            origin: new URL(redirectTo).origin,
          }),
        );
        if (result.ok) {
          return NextResponse.json({ granted: true, emailSent: true });
        }
        return NextResponse.json({
          granted: true,
          emailSent: false,
          reason: "The invitation email could not be sent. Try Resend again.",
        });
      } catch {
        return NextResponse.json({
          granted: true,
          emailSent: false,
          reason: "The invitation email could not be sent. Try Resend again.",
        });
      }
    }

    if (linkError && /already.*(registered|exists|been invited)/i.test(linkError.message)) {
      return NextResponse.json({
        granted: true,
        emailSent: false,
        alreadyRegistered: true,
        reason: "They already have an account — access applies the next time they sign in.",
      });
    }
  }

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });

  if (inviteError) {
    const alreadyRegistered = /already.*(registered|exists|been invited)/i.test(inviteError.message);
    return NextResponse.json({
      granted: true,
      emailSent: false,
      alreadyRegistered,
      reason: alreadyRegistered
        ? "They already have an account — access applies the next time they sign in."
        : inviteError.message,
    });
  }

  return NextResponse.json({ granted: true, emailSent: true });
}
