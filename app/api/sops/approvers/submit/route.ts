import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireApiUser, createApiRateLimiter } from "@/lib/api-auth";
import { renderWorkspaceInviteEmail, renderWorkspaceAccessGrantedEmail } from "@/domain/workspace/invite-email";
import { workspaceInviteAcceptanceUrl } from "@/domain/workspace/invite";
import type { SopEmailContent } from "@/domain/sop/notifications";
import type { Json } from "@/lib/database.types";
import type { Database } from "@/lib/database.types";
import { generateSetupLink, inviteRedirectTarget, deliverInvitationEmail } from "@/lib/workspace/invite-delivery";
import { createEmailSenderFromEnv } from "@/lib/notifications/sender-from-env";
import { nominatedReviewerEntitlements, parseNominationOutcome } from "@/domain/workspace/reviewer-nomination";
import { describeInviteEntitlements } from "@/domain/workspace/invite-access";
const limit = createApiRateLimiter({ windowMs: 60_000, maxRequests: 10 });
export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (auth.failure) return auth.failure;
  if (!limit(auth.userId)) return NextResponse.json({ error: "Try again in a minute." }, { status: 429 });
  const body = await request.json().catch(() => null);
  if (typeof body?.sopId !== "string" || typeof body?.expectedUpdatedAt !== "string") return NextResponse.json({ error: "A saved SOP version is required." }, { status: 400 });
  const db = auth.supabase;
  let reviewStarted = false;
  let lock: { admin: ReturnType<typeof createClient<Database>>; token: string } | null = null;
  try {
    const { data: doc, error: readError } = await db.from("sops").select("id,workspace_id,status,created_by,submitted_by,updated_at").eq("id",body.sopId).is("deleted_at",null).maybeSingle();
    if (readError || !doc) throw new Error("This SOP could not be loaded.");
    if (doc.status === "draft") {
      const { data: editable, error } = await db.rpc("can_edit_sop_content",{ p_sop: doc.id });
      if (error || !editable) throw new Error("You cannot submit this SOP.");
      if (doc.updated_at !== body.expectedUpdatedAt) throw new Error("The SOP changed. Reload before submitting.");
    } else if (doc.status !== "in_review" || (doc.created_by !== auth.userId && doc.submitted_by !== auth.userId)) {
      throw new Error("You cannot submit this SOP.");
    }
    reviewStarted = doc.status === "in_review";
    const { data: nominations, error: nominationsError } = await db.from("sop_approver_nominations").select("*").eq("sop_id",doc.id);
    if (nominationsError) throw new Error(nominationsError.message);
    const pending = (nominations ?? []).filter((row) => !row.delivered_at);
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const send = createEmailSenderFromEnv().send;
    if (pending.length && (!serviceKey || !send)) throw new Error("Invitation email delivery is not configured. The SOP remains saved.");
    const admin = serviceKey ? createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!,serviceKey,{ auth:{ persistSession:false,autoRefreshToken:false } }) : null;
    if (admin && pending.length) {
      const { data: token, error: lockError } = await admin.rpc("acquire_sop_submission_lock", { p_sop_id:doc.id });
      if (lockError) throw new Error(lockError.message);
      if (!token) throw new Error("Submission is already running. Wait for it to finish before retrying.");
      lock = { admin, token };
      // Recheck after acquiring the lock: another request may have submitted while we waited.
      const { data: current, error } = await db.from("sops").select("status,updated_at").eq("id",doc.id).single();
      if (error || !current || current.status !== doc.status || (doc.status === "draft" && current.updated_at !== body.expectedUpdatedAt)) {
        reviewStarted = current?.status === "in_review";
        throw new Error("The SOP changed during submission. Reload its current state before retrying.");
      }
    }
    const redirectTo = inviteRedirectTarget(request.url);
    // Preparation creates accounts/access only on an explicit Send for review. It never emails.
    if (doc.status === "draft") {
      for (const nomination of pending) {
        const { data, error } = await db.rpc("nominate_department_reviewer",{ p_sop_id:doc.id,p_department_id:nomination.department_id,p_email:nomination.email,p_position_title:nomination.position_title });
        if (error) throw new Error(error.message);
        const outcome = parseNominationOutcome(data);
        if (!outcome) throw new Error("The approver could not be prepared.");
        let userId = outcome.userId;
        if (outcome.mode === "invite") {
          const link = await generateSetupLink(admin!,nomination.email,redirectTo);
          if (link.kind === "unavailable") throw new Error(link.message);
          userId = userId ?? link.userId;
          if (!userId) throw new Error("The approver account could not be prepared.");
          const { error: mintError } = await db.rpc("mint_pending_department_reviewer",{ p_department_id:nomination.department_id,p_user_id:userId });
          if (mintError) throw new Error(mintError.message);
        } else {
          // Existing people already invited/registered need only the normal review notification.
          const { error: markError } = await admin!.from("sop_approver_nominations").update({ delivered_at:new Date().toISOString() }).eq("delivery_id",nomination.delivery_id);
          if (markError) throw new Error(markError.message);
          nomination.delivered_at = new Date().toISOString();
        }
        if (!userId) throw new Error("The approver has no account.");
        const { data: seat, error: seatError } = await db.from("sop_review_seats").update({ signer_id:userId }).eq("sop_id",doc.id).eq("department_id",nomination.department_id).select("department_id").maybeSingle();
        if (seatError || !seat) throw new Error(seatError?.message ?? "The approver was removed. Check the roster before submitting.");
      }
      // Database transition guards validate authorship, complete roster and independent approvers.
      const { data: transitioned, error } = await db.from("sops").update({ status:"in_review" }).eq("id",doc.id).eq("updated_at",body.expectedUpdatedAt).is("deleted_at",null).select("id").maybeSingle();
      if (error || !transitioned) throw new Error(error?.message ?? "The SOP changed. Reload before submitting.");
      reviewStarted = true;
    }
    const failures: string[] = [];
    for (const nomination of pending.filter((row) => !row.delivered_at)) {
      // Durable claim prevents simultaneous submissions/retries from sending twice.
      const { data: claim, error: claimError } = await admin!.from("sop_approver_nominations").update({ delivery_started_at:new Date().toISOString() }).eq("delivery_id",nomination.delivery_id).is("delivered_at",null).or(`delivery_started_at.is.null,delivery_started_at.lt.${new Date(Date.now()-10*60_000).toISOString()}`).select("delivery_id").maybeSingle();
      if (claimError) throw new Error(claimError.message);
      if (!claim) { failures.push(nomination.email); continue; }
      const { data: department } = await db.from("departments").select("name").eq("id",nomination.department_id).single();
      const { data: workspace } = await db.from("workspaces").select("name").eq("id",doc.workspace_id).single();
      const { data: stored, error: storedError } = await admin!.from("sop_approver_delivery_payloads").select("content").eq("delivery_id",nomination.delivery_id).maybeSingle();
      if (storedError) throw new Error(storedError.message);
      const saved = stored?.content as unknown as { content?: SopEmailContent; createdAt?: string } | undefined;
      if (saved?.createdAt && Date.now()-Date.parse(saved.createdAt)>23*60*60_000) {
        failures.push(nomination.email); continue; // Outside the provider deduplication window: never risk an automatic duplicate.
      }
      let content = saved?.content ?? stored?.content as unknown as SopEmailContent | undefined;
      if (!content) {
        const setup = await generateSetupLink(admin!,nomination.email,redirectTo);
        if (setup.kind === "unavailable") {
          await admin!.from("sop_approver_nominations").update({ delivery_started_at:null }).eq("delivery_id",nomination.delivery_id);
          failures.push(nomination.email); continue;
        }
        const common = { email:nomination.email,organizationName:workspace?.name ?? "your organization",origin:new URL(redirectTo).origin,accessSummary:describeInviteEntitlements(nominatedReviewerEntitlements(nomination.department_id,nomination.position_title),new Map(),new Map([[nomination.department_id,department?.name ?? "Department"]])) };
        content = setup.kind === "link"
          ? renderWorkspaceInviteEmail({ ...common,actionLink:workspaceInviteAcceptanceUrl(redirectTo,nomination.email,setup.tokenHash,setup.type) })
          : renderWorkspaceAccessGrantedEmail({ ...common,signInLink:new URL("/",redirectTo).toString() });
        const { error: payloadError } = await admin!.from("sop_approver_delivery_payloads").insert({ delivery_id:nomination.delivery_id,content:{ content,createdAt:new Date().toISOString() } as unknown as Json });
        if (payloadError) throw new Error(payloadError.message);
      }
      const delivered = await deliverInvitationEmail(send!,nomination.email,content,{ admin:admin!,kind:"invite",workspaceId:doc.workspace_id,idempotencyKey:`sop-approver:${nomination.delivery_id}` });
      const { error } = await admin!.from("sop_approver_nominations").update(delivered ? { delivered_at:new Date().toISOString() } : { delivery_started_at:null }).eq("delivery_id",nomination.delivery_id);
      if (error || !delivered) failures.push(nomination.email);
    }
    return NextResponse.json({ submitted:true, ...(failures.length ? { error:`Review started, but invitations are still pending for ${failures.join(", ")}. Retry invitation delivery. If it remains pending, contact an administrator.` } : {}) });
  } catch (error) {
    return NextResponse.json({ submitted:reviewStarted, error:error instanceof Error ? error.message : "The SOP could not be sent for review." },{ status:400 });
  } finally {
    if (lock) {
      const { error } = await lock.admin.from("sop_submission_locks").delete().eq("sop_id",body.sopId).eq("token",lock.token);
      if (error) console.error("SOP submission lock release failed", { message:error.message });
    }
  }
}
