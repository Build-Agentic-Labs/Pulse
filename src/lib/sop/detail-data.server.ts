import "server-only";

import { fetchDepartmentRolesForUser, listDepartments } from "@/lib/departments/store";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listSopAuditEvents } from "./audit-events";
import type { SopDetailInitialData } from "./detail-data";
import {
  getSopControl,
  isBlockingSeat,
  listProfileNames,
  listSeats,
  listSignatures,
} from "./review";
import { listSopReviewAnnotations, listSopReviewSubmissions } from "./review-annotations";
import { getSop } from "./store";

/**
 * Compose the editor's first render on the server. The browser receives one
 * complete, RLS-scoped payload instead of issuing a second series of requests
 * after hydration.
 */
export async function fetchSopDetailInitialData(sopId: string): Promise<SopDetailInitialData | undefined> {
  const supabase = await createSupabaseServerClient();
  const [{ data: auth }, record] = await Promise.all([
    supabase.auth.getUser(),
    getSop(sopId, supabase),
  ]);
  const userId = auth.user?.id;
  if (!userId || !record) return undefined;

  const [
    departments,
    seats,
    signatures,
    control,
    departmentRoles,
    annotations,
    submissions,
    auditEvents,
  ] = await Promise.all([
    listDepartments(record.workspaceId, supabase),
    listSeats(sopId, supabase),
    listSignatures(sopId, supabase),
    getSopControl(sopId, supabase),
    fetchDepartmentRolesForUser(userId, supabase),
    listSopReviewAnnotations(sopId, supabase),
    listSopReviewSubmissions([sopId], supabase),
    listSopAuditEvents(sopId, supabase),
  ]);

  const reviewCycle = control?.reviewCycle ?? 0;
  const blockingSeats = seats.filter((seat) => isBlockingSeat(seat.rasic));
  const reviewerNames = await listProfileNames(
    blockingSeats.flatMap((seat) => seat.signerId ? [seat.signerId] : []),
    supabase,
  );
  const workspaceDepartmentIds = new Set(departments.map((department) => department.id));

  return {
    record,
    department: departments.find((department) => department.id === record.departmentId),
    myDepartmentIds: [...departmentRoles.keys()].filter((id) => workspaceDepartmentIds.has(id)),
    approval: {
      departments,
      seats: blockingSeats,
      signatures,
      control,
      currentUserId: userId,
      departmentRoles: [...departmentRoles].filter(([id]) => workspaceDepartmentIds.has(id)),
      reviewerNames: [...reviewerNames],
      reviewAnnotations: annotations.filter(
        (annotation) => annotation.reviewCycle === reviewCycle && !annotation.resolvedAt,
      ),
      reviewSubmissions: submissions.filter(
        (submission) => submission.reviewCycle === reviewCycle,
      ),
      auditEvents,
    },
  };
}
