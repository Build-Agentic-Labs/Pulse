import {
  createPlannerSupabaseClient,
  getUserFromSession,
} from "@/domain/supabase-planner";
import { fetchMyDeptRoles, listDepartments } from "@/lib/departments/store";
import {
  getSopControl,
  isSignatureCurrent,
  listProfileNames,
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
  const reviewerNames = await listProfileNames(
    seats.flatMap((seat) => (seat.signerId ? [seat.signerId] : [])),
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
}: {
  sopId: string;
  persist: () => Promise<boolean>;
  seats: SopReviewSeat[];
  readyForSignatures: boolean;
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
