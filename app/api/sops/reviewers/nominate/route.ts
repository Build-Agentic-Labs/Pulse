import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { describeInviteEntitlements } from "@/domain/workspace/invite-access";
import {
  nominatedReviewerEntitlements,
  parseNominationBody,
  parseNominationOutcome,
  type NominationMode,
  type NominationResponse,
} from "@/domain/workspace/reviewer-nomination";
import { createApiRateLimiter, requireApiUser } from "@/lib/api-auth";
import { describeUnavailable, logMissingConfig } from "@/lib/auth/password-recovery-request";
import type { Database } from "@/lib/database.types";
import { insertInboxRows } from "@/lib/notifications/inbox-writer";
import { createEmailSenderFromEnv } from "@/lib/notifications/sender-from-env";
import { createResendSender } from "@/lib/sop/notifications-drain";
import { inviteRedirectTarget, sendInvitationViaResend } from "@/lib/workspace/invite-delivery";

export const dynamic = "force-dynamic";

const checkRateLimit = createApiRateLimiter({ windowMs: 60_000, maxRequests: 10 });

interface NominationScope {
  workspaceId: string;
  workspaceName: string;
  departmentId: string;
  departmentName: string;
}

async function loadScope(supabase: SupabaseClient<Database>, departmentId: string): Promise<NominationScope | null> {
  const { data: department, error: departmentError } = await supabase
    .from("departments")
    .select("id, name, workspace_id")
    .eq("id", departmentId)
    .maybeSingle();
  if (departmentError || !department) return null;
  const { data: workspace } = await supabase.from("workspaces").select("name").eq("id", department.workspace_id).maybeSingle();
  return {
    workspaceId: department.workspace_id,
    workspaceName: workspace?.name ?? "your organization",
    departmentId: department.id,
    departmentName: department.name,
  };
}

/** In-app only: owners/admins learn who nominated whom. The nominator never notifies themselves. */
async function notifyManagers(
  admin: SupabaseClient<Database>,
  scope: NominationScope,
  sopId: string,
  actorId: string,
  email: string,
  mode: NominationMode,
  emailSent: boolean,
): Promise<void> {
  const [managers, actor] = await Promise.all([
    admin.from("workspace_members").select("user_id").eq("workspace_id", scope.workspaceId).in("role", ["owner", "admin"]),
    admin.from("profiles").select("full_name").eq("id", actorId).maybeSingle(),
  ]);
  if (managers.error) {
    console.error("Reviewer nomination: manager notice lookup failed", { message: managers.error.message });
    return;
  }
  if (actor.error) {
    console.error("Reviewer nomination: manager notice lookup failed", { message: actor.error.message });
  }
  const actorName = actor.data?.full_name || "An author";
  const title = `${actorName} nominated ${email} as a reviewer for ${scope.departmentName}`;
  const body =
    mode === "invite"
      ? emailSent
        ? "An invitation was sent. They can be seated now; the review will be waiting when they join."
        : "The invitation email did not go out yet. They can be seated now; resend the invitation from the roster."
      : "They can now be selected as a departmental approver.";
  await insertInboxRows(
    admin,
    (managers.data ?? [])
      .filter((member) => member.user_id !== actorId)
      .map((member) => ({
        recipientId: member.user_id,
        workspaceId: scope.workspaceId,
        source: "workspace" as const,
        kind: "reviewer_nominated",
        entityType: "sop",
        entityId: sopId,
        title,
        body,
        link: `/sops/${sopId}`,
      })),
  );
}

/**
 * Nominate a reviewer for the caller's own department. Authorization lives in the
 * nominate_department_reviewer RPC (department membership, Quality gate, approved domain,
 * revocations, role ceiling). The service-role key is used only to send the invitation email and
 * to write the managers' in-app notice — exactly the split app/api/invites/route.ts uses.
 */
export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (auth.failure) return auth.failure;
  if (!checkRateLimit(auth.userId)) {
    return NextResponse.json({ error: "Too many invites right now — try again in a few minutes." }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const body = parseNominationBody(raw);
  if (!body) {
    return NextResponse.json({ error: "sopId, departmentId, email, and positionTitle are required." }, { status: 400 });
  }

  const supabase = auth.supabase;
  const { data: outcomeRaw, error: rpcError } = await supabase.rpc("nominate_department_reviewer", {
    p_department_id: body.departmentId,
    p_email: body.email,
    p_position_title: body.positionTitle,
  });
  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 400 });
  }
  const outcome = parseNominationOutcome(outcomeRaw);
  if (!outcome) {
    return NextResponse.json({ error: "The nomination returned an unexpected result." }, { status: 500 });
  }

  const scope = await loadScope(supabase, body.departmentId);
  if (!scope) {
    return NextResponse.json({ error: "That department could not be loaded." }, { status: 500 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const admin = serviceRoleKey
    ? createClient<Database>(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;

  if (outcome.mode !== "invite") {
    if (admin) {
      await notifyManagers(admin, scope, body.sopId, auth.userId, body.email, outcome.mode, false);
    } else {
      logMissingConfig("Reviewer invitations", ["SUPABASE_SERVICE_ROLE_KEY"], process.env.VERCEL_ENV);
    }
    const response: NominationResponse = { mode: outcome.mode, userId: outcome.userId, emailSent: false, seated: true };
    return NextResponse.json(response);
  }

  if (!admin) {
    logMissingConfig("Reviewer invitations", ["SUPABASE_SERVICE_ROLE_KEY"], process.env.VERCEL_ENV);
    const response: NominationResponse = {
      mode: "invite",
      userId: outcome.userId,
      emailSent: false,
      seated: false,
      error: `${describeUnavailable("Invitations", process.env.VERCEL_ENV)} Missing configuration: SUPABASE_SERVICE_ROLE_KEY.`,
    };
    return NextResponse.json(response);
  }

  const redirectTo = inviteRedirectTarget(request.url);
  const resendApiKey = process.env.RESEND_API_KEY ?? "";
  const resendFrom = process.env.RESEND_FROM ?? "";

  let userId = outcome.userId;
  let emailSent = false;
  let emailError: string | undefined;

  if (resendApiKey && resendFrom) {
    const send = createEmailSenderFromEnv().send ?? createResendSender(resendApiKey, resendFrom);
    const accessSummary = describeInviteEntitlements(
      nominatedReviewerEntitlements(scope.departmentId, body.positionTitle),
      new Map(),
      new Map([[scope.departmentId, scope.departmentName]]),
    );
    const resendOutcome = await sendInvitationViaResend(admin, send, {
      email: body.email,
      redirectTo,
      accessSummary,
      organizationName: scope.workspaceName,
      workspaceId: scope.workspaceId,
    });
    if (resendOutcome.kind === "sent") {
      emailSent = true;
      userId = userId ?? resendOutcome.userId;
    } else if (resendOutcome.kind === "send_failed") {
      emailSent = false;
      userId = userId ?? resendOutcome.userId;
      emailError = "The invitation email could not be sent. Try Resend again.";
    } else if (resendOutcome.kind === "already_registered") {
      emailSent = resendOutcome.delivered;
      userId = userId ?? resendOutcome.userId;
    } else {
      emailSent = false;
      emailError = resendOutcome.message;
    }
  } else {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(body.email, { redirectTo });
    if (error) {
      emailError = error.message;
    } else {
      emailSent = true;
      userId = userId ?? data.user?.id ?? null;
    }
  }

  let seated = false;
  let seatError: string | undefined;
  if (userId) {
    const { error: mintError } = await supabase.rpc("mint_pending_department_reviewer", {
      p_department_id: body.departmentId,
      p_user_id: userId,
    });
    if (mintError) seatError = mintError.message;
    else seated = true;
  }

  await notifyManagers(admin, scope, body.sopId, auth.userId, body.email, "invite", emailSent);

  const response: NominationResponse = {
    mode: "invite",
    userId,
    emailSent,
    seated,
    ...(seatError
      ? { error: seatError }
      : emailSent
        ? {}
        : { error: emailError ?? "The invitation email could not be sent. Try Resend again." }),
  };
  return NextResponse.json(response);
}
