/**
 * The Change Approvals table, derived from the approval roster and the signatures collected
 * against it.
 *
 * This is the "one source of truth" the approvals design turns on. The PDF built this inline and
 * the Word export printed a different table entirely — the static `sop.approvals` array, which no
 * UI can edit and which is blank on every hand-authored SOP. One builder now feeds both, so the
 * two documents cannot disagree about who approved an SOP.
 *
 * Note what decides the rows: the SEATS, not the document. A seat with no signature still produces
 * a row (an unsigned approval line), because the roster is what says whose approval is required.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { listDepartments, listMembersForDepartments } from "@/lib/departments/store";
import type { SignatureStrokes } from "@/domain/sop/signature";
import type { Database } from "@/lib/database.types";
import {
  getSopAuthorDisplayName,
  getSopControl,
  isBlockingSeat,
  isSignatureCurrent,
  listProfileNames,
  listSeats,
  listSignatures,
} from "./review";

export interface ApprovalSignatureEntry {
  key: string;
  approval: string;
  name: string;
  position: string;
  signedAt: string | null;
  signatureStrokes: SignatureStrokes;
}

export interface ApprovalEntriesResult {
  entries: ApprovalSignatureEntry[];
  /** Name shown as the document's author; falls back through profile, signature, then a label. */
  systemAuthorName: string;
}

const EMPTY: ApprovalEntriesResult = { entries: [], systemAuthorName: "System author" };

/**
 * Build the approval rows for one SOP.
 *
 * Departmental approvals come first, in roster order, then the Quality release approval — which is
 * NOT a seat: Quality signs the release gate, and the transition guard forbids it holding one.
 */
export async function buildApprovalEntries(
  sopId: string,
  client?: SupabaseClient<Database>,
): Promise<ApprovalEntriesResult> {
  const [control, seats, signatures, authorDisplayName] = await Promise.all([
    getSopControl(sopId, client),
    listSeats(sopId, client),
    listSignatures(sopId, client),
    getSopAuthorDisplayName(sopId),
  ]);
  if (!control) return EMPTY;

  const departments = await listDepartments(control.workspaceId, client);
  // One batched query for all departments' members instead of one per department.
  const allMembers = await listMembersForDepartments(departments.map((department) => department.id));
  const memberPositionByDepartmentAndUser = new Map<string, string>();
  allMembers.forEach((member) => {
    memberPositionByDepartmentAndUser.set(`${member.departmentId}:${member.userId}`, member.positionTitle);
  });

  const profileIds = seats.flatMap((seat) => (seat.signerId ? [seat.signerId] : []));
  const authorId = control.createdBy ?? control.submittedBy ?? control.finalApprovalRequestedBy;
  if (authorId) profileIds.push(authorId);
  const names = await listProfileNames(profileIds, client);
  const departmentById = new Map(departments.map((department) => [department.id, department]));

  const entries: ApprovalSignatureEntry[] = [];
  for (const seat of seats.filter((item) => isBlockingSeat(item.rasic))) {
    const department = departmentById.get(seat.departmentId);
    const signature = signatures.find(
      (item) =>
        item.meaning === "dept_approval" &&
        item.seatDepartmentId === seat.departmentId &&
        item.signerId === seat.signerId &&
        isSignatureCurrent(item, control),
    );
    entries.push({
      key: `seat-${seat.departmentId}`,
      approval: "Department approval",
      name: signature?.signerName || (seat.signerId ? names.get(seat.signerId) : "") || "Assigned approver",
      position:
        (seat.signerId ? memberPositionByDepartmentAndUser.get(`${seat.departmentId}:${seat.signerId}`) : "") ||
        (department ? `${department.code} · ${department.name}` : "Department approver"),
      signedAt: signature?.signedAt ?? null,
      signatureStrokes: signature?.signatureStrokes ?? [],
    });
  }

  const qualityApproval = signatures.find(
    (signature) => signature.meaning === "quality_approval" && isSignatureCurrent(signature, control),
  );
  if (qualityApproval) {
    entries.push({
      key: qualityApproval.id,
      approval: "Quality approval",
      name: qualityApproval.signerName || "Quality approver",
      position:
        departments
          .filter((department) => department.isQualityGate)
          .map((department) =>
            memberPositionByDepartmentAndUser.get(`${department.id}:${qualityApproval.signerId}`),
          )
          .find(Boolean) || "Quality release",
      signedAt: qualityApproval.signedAt,
      signatureStrokes: qualityApproval.signatureStrokes,
    });
  }

  const authorshipSignature = signatures.find((signature) => signature.meaning === "authorship");
  return {
    entries,
    systemAuthorName:
      authorDisplayName ||
      (authorId ? names.get(authorId)?.trim() : "") ||
      authorshipSignature?.signerName.trim() ||
      "System author",
  };
}
