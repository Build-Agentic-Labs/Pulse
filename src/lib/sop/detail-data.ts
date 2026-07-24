import type { Department, DeptRole } from "@/domain/departments";
import type { SopAuditEvent } from "./audit-events";
import type { SopControl, SopReviewSeat, SopSignature } from "./review";
import type { SopReviewAnnotation, SopReviewSubmission } from "./review-annotations";
import type { SopRecord } from "./store";

export interface SopApprovalRoutingInitialData {
  departments: Department[];
  seats: SopReviewSeat[];
  signatures: SopSignature[];
  control?: SopControl;
  currentUserId: string;
  departmentRoles: Array<[string, DeptRole]>;
  reviewerNames: Array<[string, string]>;
  reviewAnnotations: SopReviewAnnotation[];
  reviewSubmissions: SopReviewSubmission[];
  auditEvents: SopAuditEvent[];
}

export interface SopDetailInitialData {
  record: SopRecord;
  department?: Department;
  myDepartmentIds: string[];
  approval: SopApprovalRoutingInitialData;
}
