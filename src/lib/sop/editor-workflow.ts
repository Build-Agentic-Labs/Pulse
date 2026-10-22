import type { ImpactAssessment } from "@/components/sop/change-impact-confirmations";
import { kickSopNotifications } from "./notify-kick";
import {
  createPlannerSupabaseClient,
  getUserFromSession,
} from "@/domain/supabase-planner";
import { fetchMyDeptRoles, listDepartments } from "@/lib/departments/store";
import {
  getSopControl,
  isSignatureCurrent,
  listSopApproverNames,
  listSeats,
  listSignatures,
  sendSopForSignatures,
  signSop,
  submitSopWithApproverInvitations,
  transitionSop,
  type SopReviewSeat,
} from "./review";

/** Fetches one routing snapshot; the caller owns stale-response guards and UI state. */
export async function loadEditorApprovalRouting(
  workspaceId: string,
  sopId: string,
  persisted: boolean,
) {
  const supabase = createPlannerSupabaseClient();
  const [departments, seats, signatures, control, userResult, departmentRoles] =
    await Promise.all([
      listDepartments(workspaceId),
      persisted ? listSeats(sopId) : Promise.resolve([]),
      persisted ? listSignatures(sopId) : Promise.resolve([]),
      persisted ? getSopControl(sopId) : Promise.resolve(undefined),
      getUserFromSession(supabase),
      fetchMyDeptRoles(workspaceId),
    ]);
  const reviewerNames = await listSopApproverNames(
    persisted ? [sopId] : [],
  );
  return {
    departments,
    seats,
    signatures,
    control,
    userResult,
    departmentRoles,
    reviewerNames,
  };
}

export async function requestEditorSignatures(
  sopId: string,
  contentHash: string,
  reviewCycle: number,
) {
  await sendSopForSignatures(sopId, contentHash, reviewCycle);
  const control = await getSopControl(sopId);
  if (!control)
    throw new Error(
      "The signature request could not be refreshed. Reload the SOP.",
    );
  return control;
}

/** Save gates signing and submission. Returns null when the draft could not be saved.
 * Errors deliberately propagate: the editor reconciles any already-committed review
 * transition before presenting an invitation-delivery failure.
 */
export async function submitEditorDraft({
  sopId,
  persist,
  seats,
  readyForSignatures,
  impactAssessment,
}: {
  sopId: string;
  persist: () => Promise<boolean>;
  seats: SopReviewSeat[];
  readyForSignatures: boolean;
  impactAssessment?: ImpactAssessment;
}) {
  if (!(await persist())) return null;
  const control = await getSopControl(sopId);
  if (!control)
    throw new Error("The saved SOP could not be loaded for submission.");
  if (control.status !== "draft") {
    if (
      control.status === "in_review" &&
      seats.some((seat) => seat.nomination && !seat.nomination.deliveredAt)
    ) {
      await submitSopWithApproverInvitations(sopId, control.updatedAt);
    }
    return { control, destination: "draft-review" as const, refresh: false };
  }
  if (control.effectiveRevisionId && control.changeSignificance) {
    if (!impactAssessment?.impactConfirmed ||
      (control.changeSignificance === "MINOR" && !impactAssessment.processOwnerConfirmed))
      throw new Error("Complete the change impact assessment before submitting.");
    const { error } = await createPlannerSupabaseClient().rpc("confirm_sop_change_impact", {
      p_sop: sopId, p_expected_hash: control.contentHash ?? "", p_expected_cycle: control.reviewCycle,
      p_sections: "", p_impact_confirmed: impactAssessment.impactConfirmed,
      p_process_owner_confirmed: impactAssessment.processOwnerConfirmed,
    });
    if (error) throw new Error(error.message);
  }
  if (control.effectiveRevisionId && control.changeSignificance && !seats.some((seat) => seat.nomination)) {
    const db = createPlannerSupabaseClient();
    const { error } = await db.rpc("submit_sop_controlled_draft", {
      p_sop: sopId, p_expected_hash: control.contentHash ?? "", p_expected_cycle: control.reviewCycle,
    });
    if (error) throw new Error(error.message);
    const next = await getSopControl(sopId);
    if (!next) throw new Error("The controlled change could not be refreshed.");
    kickSopNotifications();
    return { control: next, destination: next.status === "approved" ? "quality-approval" as const :
      next.finalApprovalRequestedAt ? "final-approval" as const : "draft-review" as const, refresh: true };
  }
  if (readyForSignatures) {
    const requested = await requestEditorSignatures(
      sopId,
      control.contentHash ?? "",
      control.reviewCycle,
    );
    return {
      control: requested,
      destination: "final-approval" as const,
      refresh: true,
    };
  }
  const supabase = createPlannerSupabaseClient();
  const userResult = await getUserFromSession(supabase);
  const userId = userResult.data.user?.id;
  if (!userId)
    throw new Error(
      "Your session expired. Sign in again before submitting this SOP.",
    );
  const signatures = await listSignatures(sopId);
  const hasCurrentAuthorship = signatures.some(
    (signature) =>
      signature.meaning === "authorship" &&
      signature.signerId === userId &&
      isSignatureCurrent(signature, control),
  );
  if (!hasCurrentAuthorship) await signSop(sopId, "authorship");
  const latest = await getSopControl(sopId);
  if (!latest) throw new Error("The SOP could not be reloaded after signing.");
  const transitioned = seats.some((seat) => seat.nomination)
    ? await submitSopWithApproverInvitations(sopId, latest.updatedAt)
    : await transitionSop(sopId, "in_review", latest.updatedAt);
  return {
    control: transitioned,
    destination: "draft-review" as const,
    refresh: true,
  };
}
