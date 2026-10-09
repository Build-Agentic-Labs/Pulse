"use client";

import { useCoalescedRefresh } from "@/lib/use-coalesced-refresh";

import { kickSopNotifications } from "@/lib/sop/notify-kick";

import { Check, ChevronLeft, ChevronRight, Download, FileText, History, Loader2, MessageSquare, ShieldCheck, Sparkles, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useConfirm } from "@/components/confirm-provider";

import type { Department, DeptRole } from "@/domain/departments";
import { draftReviewGate } from "@/domain/sop/review-gate";
import { shouldPollReviewAnnotations } from "@/domain/sop/review-polling";
import { type Sop } from "@/domain/sop/schema";
import { listDecisionBranchRequirements } from "@/domain/sop/procedure-validation";
import { type ChangeSignificance } from "@/domain/sop/version";
import { authoringMode, DEFAULT_DOC_TYPE, documentNumberLabel } from "@/domain/sop/authoring";
import { loadEditorApprovalRouting, requestEditorSignatures, submitEditorDraft } from "@/lib/sop/editor-workflow";
import {
  getSopControl,
  isBlockingSeat,
  transitionSop,
  submitSopWithApproverInvitations,
  type SopReviewSeat,
  type SopSignature,
} from "@/lib/sop/review";
import { getSop, listSops, type SopListItem } from "@/lib/sop/store";
import { addRasicRole, listRasicRoles } from "@/lib/sop/rasic-roles/store";
import type { SopSearchResult } from "@/lib/sop/search";
import { buildApprovalEntries } from "@/lib/sop/approval-entries";
import {
  listSopReviewAnnotations,
  listSopReviewSubmissions,
  resolveSopReviewAnnotation,
  type SopReviewAnnotation,
  type SopReviewSubmission,
} from "@/lib/sop/review-annotations";
import { listSopAuditEvents, type SopAuditEvent } from "@/lib/sop/audit-events";
import type { SopApprovalRoutingInitialData } from "@/lib/sop/detail-data";
import { AnnexesEditor } from "./editor/annexes-editor";
import { ReferenceLibraryEditor } from "./editor/reference-library-editor";
import { formatDate } from "@/domain/formatting";
import { SopDocumentSection } from "./editor/document-section";
import { SopOverviewSection } from "./editor/overview-section";
import { SopProcedureSection } from "./editor/procedure-section";
import { SopApprovalsSection } from "./editor/approvals-section";
import { SopQualitySection } from "./editor/quality-section";
import { Section, StringListEditor, PairListEditor, SystemChangeHistory } from "./editor/editor-fields";
import { useSopDraft } from "./editor/use-sop-draft";
import { useSopAttachments } from "./editor/use-sop-attachments";
import { SopShell } from "./sop-shell";
import { AutoTextarea } from "./auto-textarea";

import { ResponsiblePersonsField } from "./responsible-persons-field";
import { SopDetailLoadingState } from "./sop-detail-loading-state";
import { SopPrintPreview } from "./sop-print-preview";
import { SopRemarkCard } from "./sop-feedback-panel";
import { QUEUE_ORIGIN_PARAM, QUEUE_ORIGIN_VALUE, REVIEW_QUEUE_HREF } from "@/domain/sop/queue-navigation";
import type { MarginNote } from "./sop-margin-notes";
import { ReferencePdfPreview } from "./reference-pdf-preview";
import { SopQualityApprovalWorkspace } from "./sop-quality-approval-workspace";

import { SopSearch } from "./sop-search";
import {
  clearSopSearchMatch,
  revealSopSearchMatch,
  type SopSearchMatchHandle,
} from "./sop-search-match";
import {
  initialSopEditorStepIndex,
  requestedSopEditorStepId,
  type SopEditorInitialView,
} from "./sop-editor-step";
import { SopStepNavIcon } from "./sop-step-nav-icon";

export type { SopEditorInitialView } from "./sop-editor-step";

type StepId =
  | "document"
  | "overview"
  | "procedure"
  | "annexes"
  | "approvals"
  | "draftReview"
  | "finalApproval"
  | "qualityApproval";

const CREATOR_STEPS: Array<{ id: StepId; label: string }> = [
  { id: "document", label: "Document" },
  { id: "overview", label: "Overview" },
  { id: "procedure", label: "Procedure" },
  { id: "annexes", label: "Annexes & history" },
  { id: "approvals", label: "Approvals" },
];

const DRAFT_REVIEW_STEP: { id: StepId; label: string } = { id: "draftReview", label: "Draft Review" };
const FINAL_APPROVAL_STEP: { id: StepId; label: string } = { id: "finalApproval", label: "Final Approval" };
const QUALITY_APPROVAL_STEP: { id: StepId; label: string } = { id: "qualityApproval", label: "Quality Approval" };

const REVIEW_CATEGORY_STEPS: Record<string, StepId> = {
  document: "document",
  purpose: "overview",
  scope: "overview",
  definitions: "overview",
  references: "overview",
  responsible: "procedure",
  measurements: "procedure",
  procedure: "procedure",
  annexes: "annexes",
  history: "annexes",
  overall: "document",
};

const STEP_REVIEW_CATEGORIES: Partial<Record<StepId, string[]>> = {
  document: ["document", "overall"],
  overview: ["purpose", "scope", "definitions", "references"],
  procedure: ["responsible", "measurements", "procedure"],
  annexes: ["annexes", "history"],
};

const AUDIT_EVENT_LABELS: Record<string, string> = {
  review_sent: "Sent for review",
  review_recalled: "Recalled for changes",
  review_returned: "Review returned",
  remark_added: "Remark added",
  remark_updated: "Remark updated",
  remark_resolved: "Remark marked addressed",
  remark_deleted: "Remark deleted",
  final_approval_requested: "Sent for final approval",
  status_changed: "Status changed",
  signature_added: "Signature recorded",
  seat_reassigned: "Review seat reassigned",
  reviewer_reminded: "Reviewer reminded",
};

/** Whether a step has any content yet — drives the ✓ marker in the step nav. */
function stepFilled(sop: Sop, id: StepId): boolean {
  switch (id) {
    case "document":
      return Boolean(sop.meta.sopNumber || sop.meta.title);
    case "overview":
      return Boolean(
        sop.purpose ||
          sop.scope ||
          sop.definitions.length ||
          sop.references.length ||
          sop.linkedSops.length ||
          sop.referenceDocs.length,
      );
    case "procedure":
      return Boolean(
        sop.responsiblePersons.length ||
          sop.measurements.length ||
          sop.procedure.processFlowDescription ||
          sop.procedure.activities.length,
      ) && listDecisionBranchRequirements(sop.procedure.activities).length === 0;
    case "annexes":
      return Boolean(sop.annexes.length || sop.changeHistory.length);
    case "approvals":
      return sop.approvals.some((row) => row.name || row.position || row.date);
    case "draftReview":
    case "finalApproval":
    case "qualityApproval":
      return false;
  }
}




/** Debounce for autosave: persist this long after the last edit settles. */



const SOP_FIELD_EXAMPLES: Record<string, string> = {
  QMS: "Quality Management System",
  "1.0": "1.0",
  "Define the purpose of this process": "Ensure urgent orders are reviewed and approved consistently.",
  "For which products, processes or areas this applies": "Applies to rush orders that require a production schedule change.",
  Term: "Lead time",
  Definition: "Time between order approval and the start of production.",
  "e.g. ISO 9001:2015": "ISO 9001:2015",
  "Function / role": "Production Manager",
  "e.g. % of released SOPs": "Urgent-order approvals completed within 24 hours.",
  "Describe the process flow": "Request received → capacity reviewed → approval issued.",
  Role: "Quality Manager",
  Input: "Customer escalation request",
  Step: "Review order priority and available capacity",
  Output: "Approved escalation decision",
  "Describe the activity": "Confirm order details, production impact, and required approval.",
  Label: "Appendix A",
  Description: "Order escalation approval form",
  Version: "1.1",
  "Description of changes": "Added the Quality approval step.",
  "Created by": "Jane Smith",
  Position: "Quality Manager",
  Name: "Jane Smith",
};

const REVIEW_CATEGORY_LABELS: Record<string, string> = {
  document: "Document control",
  purpose: "Purpose",
  scope: "Scope",
  definitions: "Definitions",
  responsible: "Responsible parties",
  references: "References",
  measurements: "Measurements",
  procedure: "Procedure & process flow",
  annexes: "Annexes & forms",
  history: "Change history",
  overall: "Overall remarks",
};

type FieldHint = { text: string; left: number; top: number; above: boolean };

function getEmptyFieldExample(target: EventTarget): { element: HTMLInputElement | HTMLTextAreaElement; text: string } | null {
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return null;
  if (target.disabled || target.readOnly || target.value.trim()) return null;
  const text =
    target.dataset.example?.trim() ||
    SOP_FIELD_EXAMPLES[target.placeholder] ||
    (target instanceof HTMLInputElement && target.type === "date" ? "12/31/2026" : "");
  return text ? { element: target, text } : null;
}

export function SopEditor({
  initial,
  workspaceId,
  owningDepartment,
  canEdit: canEditPermission = true,
  isNew = false,
  authoringDepartments,
  initialApprovalRouting,
  initialView,
}: {
  initial: Sop;
  workspaceId?: string;
  /** Persisted owner for an existing SOP. New SOPs derive this from authoringDepartments. */
  owningDepartment?: Department;
  canEdit?: boolean;
  /** True when the SOP has never been persisted (the first autosave inserts it). */
  isNew?: boolean;
  /** The departments the author may own this SOP with. Present only for new SOPs (length >= 1). */
  authoringDepartments?: Department[];
  /** Server-composed approval/review state for an existing SOP's first paint. */
  initialApprovalRouting?: SopApprovalRoutingInitialData;
  /** Deep-linked view supplied by the route before the editor's first render. */
  initialView?: SopEditorInitialView;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // "?from=<sopId>&fromNumber=<label>" marks a preview reached via another SOP's
  // References list; surface a Back button that returns to that SOP's preview.
  const previewBackSopId = searchParams.get("from");
  // Captured once: later in-page URL rewrites (step changes) drop the flag, the origin doesn't.
  const [cameFromQueue] = useState(() => searchParams.get(QUEUE_ORIGIN_PARAM) === QUEUE_ORIGIN_VALUE);
  const previewBackLink = previewBackSopId
    ? { href: `/sops/${encodeURIComponent(previewBackSopId)}?preview=pdf`, label: "Back" }
    : undefined;
  const confirm = useConfirm();
  // Owning-department selection for a new SOP (undefined mode => not the create flow).
  const authMode = isNew && authoringDepartments ? authoringMode(authoringDepartments) : null;
  const [deptId, setDeptId] = useState<string>(() => {
    if (authMode?.kind === "single") return authMode.department.id;
    if (authMode?.kind === "choose") return authMode.departments[0]?.id ?? "";
    return "";
  });
  const selectedDept = owningDepartment ?? authoringDepartments?.find((d) => d.id === deptId) ?? null;
  const selectedDepartmentId = selectedDept?.id ?? "";
  const [reloadingLatest, setReloadingLatest] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [previewing, setPreviewing] = useState(initialView === "pdf");
  const [previewOnly] = useState(initialView === "pdf");
  const [qualityApprovalOpen, setQualityApprovalOpen] = useState(false);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const searchRevealTimerRef = useRef<number | null>(null);
  const activeSearchMatchRef = useRef<SopSearchMatchHandle | null>(null);
  const [showConvertedReview, setShowConvertedReview] = useState(false);
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const [reviewVisible, setReviewVisible] = useState(false);
  const [fieldHint, setFieldHint] = useState<FieldHint | null>(null);
  // Roles this workspace has added, offered under "Added by your team" in the RASIC dropdown.
  // Lazily loaded on the procedure step, same as the References picker below: dropdown contents
  // are not first-paint content.
  const [workspaceRoleNames, setWorkspaceRoleNames] = useState<string[]>([]);
  // Workspace SOPs offered by the References picker; loaded lazily on the overview step.
  const [linkableSops, setLinkableSops] = useState<SopListItem[] | undefined>(undefined);
  const [linkableSopsError, setLinkableSopsError] = useState("");
  const [approvalDepartments, setApprovalDepartments] = useState<Department[]>(
    () => initialApprovalRouting?.departments ?? [],
  );
  const [approvalSeats, setApprovalSeats] = useState<SopReviewSeat[]>(
    () => initialApprovalRouting?.seats ?? [],
  );
  const [approvalSignatures, setApprovalSignatures] = useState<SopSignature[]>(
    () => initialApprovalRouting?.signatures ?? [],
  );
  const [approvalReviewerNames, setApprovalReviewerNames] = useState<Map<string, string>>(
    () => new Map(initialApprovalRouting?.reviewerNames ?? []),
  );
  const [approvalAuthorId, setApprovalAuthorId] = useState<string | null>(
    () => initialApprovalRouting?.control?.createdBy ?? null,
  );
  const [approvalReviewCycle, setApprovalReviewCycle] = useState(
    () => initialApprovalRouting?.control?.reviewCycle ?? 0,
  );
  const [approvalContentHash, setApprovalContentHash] = useState<string | null>(
    () => initialApprovalRouting?.control?.contentHash ?? null,
  );
  const [finalApprovalRequestedAt, setFinalApprovalRequestedAt] = useState<string | null>(
    () => initialApprovalRouting?.control?.finalApprovalRequestedAt ?? null,
  );
  const [finalApprovalContentHash, setFinalApprovalContentHash] = useState<string | null>(
    () => initialApprovalRouting?.control?.finalApprovalContentHash ?? null,
  );
  const [isCurrentUserAuthor, setIsCurrentUserAuthor] = useState(
    () => Boolean(
      initialApprovalRouting?.control?.createdBy &&
      initialApprovalRouting.control.createdBy === initialApprovalRouting.currentUserId
    ),
  );
  const [isCurrentUserSubmitter, setIsCurrentUserSubmitter] = useState(() => Boolean(initialApprovalRouting?.control?.submittedBy && initialApprovalRouting.control.submittedBy === initialApprovalRouting.currentUserId));
  const [isCurrentUserQualityApprover, setIsCurrentUserQualityApprover] = useState(
    () => {
      if (!initialApprovalRouting) return false;
      const roles = new Map(initialApprovalRouting.departmentRoles);
      return initialApprovalRouting.departments.some(
        (department) => department.isQualityGate && roles.get(department.id) === "approver",
      );
    },
  );
  const [approvalMyDeptRoles, setApprovalMyDeptRoles] = useState<Map<string, DeptRole>>(
    () => new Map(initialApprovalRouting?.departmentRoles ?? []),
  );
  const [approvalRoutingLoading, setApprovalRoutingLoading] = useState(false);
  const [approvalRoutingError, setApprovalRoutingError] = useState("");
  const [reviewAnnotations, setReviewAnnotations] = useState<SopReviewAnnotation[]>(
    () => (initialApprovalRouting?.reviewAnnotations ?? []).filter((item) => !item.resolvedAt),
  );
  const [addressedAnnotations, setAddressedAnnotations] = useState<SopReviewAnnotation[]>(() => (initialApprovalRouting?.reviewAnnotations ?? []).filter((item) => Boolean(item.resolvedAt)));
  const [reviewSubmissions, setReviewSubmissions] = useState<SopReviewSubmission[]>(
    () => initialApprovalRouting?.reviewSubmissions ?? [],
  );
  const [auditEvents, setAuditEvents] = useState<SopAuditEvent[]>(
    () => initialApprovalRouting?.auditEvents ?? [],
  );
  const [auditError, setAuditError] = useState("");
  const [auditPanelOpen, setAuditPanelOpen] = useState(false);
  const [recallingReview, setRecallingReview] = useState(false);
  const [requestingFinalApproval, setRequestingFinalApproval] = useState(false);
  const [resolvingAnnotationId, setResolvingAnnotationId] = useState<string | null>(null);
  /** The remark card whose section editor is open in the review margin. */
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [submittingForApproval, setSubmittingForApproval] = useState(false);
  const [controlledChangeKind, setControlledChangeKind] = useState<ChangeSignificance | null>(null);
  const [controlledChangeReason, setControlledChangeReason] = useState("");
  const [startingControlledChange, setStartingControlledChange] = useState(false);
  const {
    sop, observeWorkflowStatus, adoptWorkflowTransition, canEdit, controlledVersion, dirty, conflicted,
    saveStatus, saveError, clearSaveError, reportSaveError, reportWorkflowSaved, persistedUpdatedAt,
    hasPersistedSop, update, persist, replaceWithLatest,
    beginControlledDraft, isAnnexPersisted,
  } = useSopDraft({
    initial, isNew, workspaceId, canEditPermission, deptId,
    hasSelectedDepartment: Boolean(selectedDept), reviewCycle: approvalReviewCycle,
    pauseAutosave: submittingForApproval || requestingFinalApproval,
  });
  const {
    annexFiles, annexFileError, reportUnavailableAttachment, referenceDocError, referencePreview, closeReferencePreview,
    uploadingReferenceDoc, uploadingAnnexId, annexUploadStatus, clearUploadStatus,
    referenceFileByDocId, handleAnnexUpload, handleAnnexOpen, handleAnnexFileRemove,
    handleReferenceDocUpload, handleReferenceDocOpen, handleReferenceDocRemove,
    handleAnnexRowRemove, handleAnnexRename,
  } = useSopAttachments({ sopId: sop.id, annexes: sop.annexes, workspaceId, hasPersistedSop,
    persist, isAnnexPersisted,
    updateReferenceDocs: change => update(current => ({ referenceDocs: change(current.referenceDocs) })),
    updateAnnexes: rows => update({ annexes: rows }),
  });
  const reviewDismissTimerRef = useRef<number | null>(null);
  const skipInitialApprovalFetchRef = useRef(Boolean(initialApprovalRouting));
  const skipInitialReviewFetchRef = useRef(Boolean(initialApprovalRouting));
  const skipInitialAuditFetchRef = useRef(Boolean(initialApprovalRouting));



  const refreshApprovalRouting = useCoalescedRefresh(useCallback(async (options: { background?: boolean; force?: boolean } = {}, isCurrent: () => boolean) => {
    if (!isCurrent()) return;
    if (!workspaceId) return;
    if (!options.background) setApprovalRoutingLoading(true);
    setApprovalRoutingError("");
    try {
      const { departments, seats, signatures, control, userResult, departmentRoles, reviewerNames } =
        await loadEditorApprovalRouting(workspaceId, sop.id, hasPersistedSop);
      if (!isCurrent()) return;
      setApprovalDepartments(departments);
      setApprovalSeats(seats.filter((seat) => isBlockingSeat(seat.rasic)));
      setApprovalSignatures(signatures);
      setApprovalReviewerNames(reviewerNames);
      setApprovalMyDeptRoles(departmentRoles);
      setApprovalAuthorId(control?.createdBy ?? null);
      setApprovalReviewCycle(control?.reviewCycle ?? 0);
      setApprovalContentHash(control?.contentHash ?? null);
      setFinalApprovalRequestedAt(control?.finalApprovalRequestedAt ?? null);
      setFinalApprovalContentHash(control?.finalApprovalContentHash ?? null);
      setIsCurrentUserAuthor(Boolean(control?.createdBy && control.createdBy === userResult.data.user?.id));
      setIsCurrentUserSubmitter(Boolean(control?.submittedBy && control.submittedBy === userResult.data.user?.id));
      setIsCurrentUserQualityApprover(
        departments.some(
          (department) => department.isQualityGate && departmentRoles.get(department.id) === "approver",
        ),
      );
      if (control) {
        observeWorkflowStatus(control.status);
      }
    } catch (error) {
      if (!isCurrent()) return;
      setApprovalRoutingError(error instanceof Error ? error.message : "Could not load approval routing.");
    } finally {
      if (isCurrent() && !options.background) setApprovalRoutingLoading(false);
    }
  }, [hasPersistedSop, observeWorkflowStatus, sop.id, workspaceId]));

  useEffect(() => {
    if (skipInitialApprovalFetchRef.current) {
      skipInitialApprovalFetchRef.current = false;
      return;
    }
    void refreshApprovalRouting({ force: true });
  }, [refreshApprovalRouting]);

  useEffect(() => {
    if (!hasPersistedSop) return;
    if (skipInitialReviewFetchRef.current) {
      skipInitialReviewFetchRef.current = false;
      return;
    }
    let active = true;
    Promise.all([
      listSopReviewAnnotations(sop.id),
      listSopReviewSubmissions([sop.id]),
    ])
      .then(([annotations, submissions]) => {
        if (!active) return;
        setReviewAnnotations(
          annotations.filter(
            (annotation) => annotation.reviewCycle === approvalReviewCycle && !annotation.resolvedAt,
          ),
        );
        setAddressedAnnotations(annotations.filter((item) => item.reviewCycle === approvalReviewCycle && item.resolvedAt));
        // Cycle-scoped, NOT hash-scoped: the draft review is a single round per
        // cycle, so verdicts stay valid after the author recalls and edits.
        setReviewSubmissions(
          submissions.filter((submission) => submission.reviewCycle === approvalReviewCycle),
        );
      })
      .catch(() => {
        // Retain the last loaded remarks and submissions on a read error, matching the
        // annotation poll: a transient failure must not blank the review conversation.
      });
    return () => {
      active = false;
    };
  }, [approvalContentHash, approvalReviewCycle, hasPersistedSop, sop.id]);

  useEffect(() => {
    if (!hasPersistedSop) return;
    if (skipInitialAuditFetchRef.current) {
      skipInitialAuditFetchRef.current = false;
      return;
    }
    let active = true;
    setAuditError("");
    void listSopAuditEvents(sop.id)
      .then((events) => {
        if (active) setAuditEvents(events);
      })
      .catch((error) => {
        if (!active) return;
        setAuditEvents([]);
        setAuditError(error instanceof Error ? error.message : "The audit trail could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [hasPersistedSop, sop.id]);

  useEffect(() => {
    if (sop.source !== "converted") return;

    const url = new URL(window.location.href);
    if (url.searchParams.get("converted") !== "1") return;

    setShowConvertedReview(true);
    url.searchParams.delete("converted");
    const query = url.searchParams.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${query ? `?${query}` : ""}${url.hash}`,
    );
  }, [sop.source]);

  useEffect(() => {
    if (!showConvertedReview || reviewDismissed) return;

    const showFrame = window.requestAnimationFrame(() => setReviewVisible(true));
    const hideTimer = window.setTimeout(() => setReviewVisible(false), 5_700);
    const removeTimer = window.setTimeout(() => setReviewDismissed(true), 6_000);

    return () => {
      window.cancelAnimationFrame(showFrame);
      window.clearTimeout(hideTimer);
      window.clearTimeout(removeTimer);
    };
  }, [reviewDismissed, showConvertedReview]);

  useEffect(() => {
    return () => {
      if (reviewDismissTimerRef.current !== null) {
        window.clearTimeout(reviewDismissTimerRef.current);
      }
    };
  }, []);

  const dismissReviewToast = () => {
    setReviewVisible(false);
    reviewDismissTimerRef.current = window.setTimeout(() => setReviewDismissed(true), 300);
  };

  const hasReviewHistory =
    reviewAnnotations.length > 0 ||
    reviewSubmissions.length > 0 ||
    auditEvents.some((event) => event.eventType.startsWith("review_") || event.eventType.startsWith("remark_"));
  const showAuditTrail = auditEvents.some((event) => event.eventType === "review_sent");
  const showDraftReview = isCurrentUserAuthor && (sop.status === "in_review" || hasReviewHistory);
  const finalApprovalRequested =
    Boolean(finalApprovalRequestedAt) &&
    finalApprovalContentHash === (approvalContentHash ?? "");
  const showFinalApproval = isCurrentUserAuthor && (
    showDraftReview ||
    finalApprovalRequested ||
    sop.status === "approved" ||
    sop.status === "effective"
  );
  const showQualityApproval =
    (isCurrentUserAuthor || isCurrentUserQualityApprover) &&
    (sop.status === "approved" ||
      sop.status === "effective" ||
      approvalSignatures.some(
        (signature) =>
          signature.meaning === "quality_approval" &&
          signature.reviewCycle === approvalReviewCycle &&
          signature.signedContentHash === (approvalContentHash ?? ""),
      ));
  const steps = useMemo(
    () => [
      ...CREATOR_STEPS,
      ...(showDraftReview ? [DRAFT_REVIEW_STEP] : []),
      ...(showFinalApproval ? [FINAL_APPROVAL_STEP] : []),
      ...(showQualityApproval ? [QUALITY_APPROVAL_STEP] : []),
    ],
    [showDraftReview, showFinalApproval, showQualityApproval],
  );
  const requestedStepId = requestedSopEditorStepId(initialView) as StepId | null;
  const requestedStepIndex = requestedStepId
    ? steps.findIndex((entry) => entry.id === requestedStepId)
    : -1;
  const [rawStepIndex, setStepIndex] = useState(() =>
    initialSopEditorStepIndex(steps, initialView),
  );
  useEffect(() => {
    if (!requestedStepId || requestedStepIndex >= 0 || approvalRoutingLoading || !approvalAuthorId || approvalRoutingError) return;
    const destination = requestedStepId === "draftReview" && !isCurrentUserAuthor
      ? `/sops?tab=review&review=${encodeURIComponent(sop.id)}`
      : `/sops/${encodeURIComponent(sop.id)}`;
    router.replace(destination);
  }, [requestedStepId, requestedStepIndex, approvalRoutingLoading, approvalAuthorId, approvalRoutingError, isCurrentUserAuthor, sop.id, router]);
  const draftReviewers = useMemo(() => {
    const reviewers = new Map<string, { userId: string; name: string; submission?: SopReviewSubmission }>();
    for (const seat of approvalSeats) {
      if (!seat.signerId || reviewers.has(seat.signerId)) continue;
      reviewers.set(seat.signerId, {
        userId: seat.signerId,
        name: approvalReviewerNames.get(seat.signerId) || "Assigned reviewer",
        submission: reviewSubmissions.find((submission) => submission.reviewerId === seat.signerId),
      });
    }
    for (const submission of reviewSubmissions) {
      if (reviewers.has(submission.reviewerId)) continue;
      reviewers.set(submission.reviewerId, {
        userId: submission.reviewerId,
        name: submission.reviewerName,
        submission,
      });
    }
    return Array.from(reviewers.values());
  }, [approvalReviewerNames, approvalSeats, reviewSubmissions]);
  const reviewGate = draftReviewGate(draftReviewers);
  // Single review round: once every reviewer has responded and the returned
  // remarks are addressed, the only forward path is final approval (signatures),
  // never another draft-review loop.
  const finalApprovalReady =
    sop.status === "in_review" &&
    reviewGate.allResponded &&
    reviewAnnotations.length === 0;
  const finalApprovalStakeholders = useMemo(() => approvalSeats
    .filter((seat) => isBlockingSeat(seat.rasic))
    .map((seat) => {
      const department = approvalDepartments.find((item) => item.id === seat.departmentId);
      const signature = approvalSignatures.find(
        (item) =>
          item.meaning === "dept_approval" &&
          item.seatDepartmentId === seat.departmentId &&
          item.signerId === seat.signerId &&
          item.reviewCycle === approvalReviewCycle &&
          item.signedContentHash === (approvalContentHash ?? ""),
      );
      return {
        seat,
        department,
        name: seat.signerId ? approvalReviewerNames.get(seat.signerId) || "Assigned approver" : "Unassigned",
        signature,
      };
    }), [
      approvalContentHash,
      approvalDepartments,
      approvalReviewerNames,
      approvalReviewCycle,
      approvalSeats,
      approvalSignatures,
    ]);
  const allFinalApprovalsSigned =
    finalApprovalStakeholders.length > 0 &&
    finalApprovalStakeholders.every((stakeholder) => Boolean(stakeholder.signature));
  const qualitySignature = approvalSignatures.find(
    (signature) =>
      signature.meaning === "quality_approval" &&
      signature.reviewCycle === approvalReviewCycle &&
      signature.signedContentHash === (approvalContentHash ?? ""),
  );
  // Final approval opens only once every reviewer has responded and every returned remark is
  // addressed (the database refuses the request otherwise); a step shown but unusable before then
  // invited authors to skip the remarks.
  const finalApprovalLocked = !(
    finalApprovalReady ||
    finalApprovalRequested ||
    sop.status === "approved" ||
    sop.status === "effective"
  );
  const finalApprovalLockReason = !reviewGate.allResponded
    ? "Available once every reviewer has responded"
    : "Address every returned remark to unlock final approval";
  // However the step was reached — a deep link (?step=final-approval), a stale index, remarks
  // reopening — a locked Final Approval renders as Draft Review, where the remarks are.
  const draftReviewStepIndex = steps.findIndex((entry) => entry.id === "draftReview");
  const stepIndex =
    steps[rawStepIndex]?.id === "finalApproval" && finalApprovalLocked && draftReviewStepIndex >= 0
      ? draftReviewStepIndex
      : rawStepIndex;
  const step = steps[stepIndex] ?? steps[0];
  const nextStepLocked = steps[stepIndex + 1]?.id === "finalApproval" && finalApprovalLocked;

  // Load the workspace SOP list the first time the overview step (which hosts the
  // References picker) becomes active; undefined = not loaded yet.
  useEffect(() => {
    if (step.id !== "procedure" || !workspaceId) return;
    let active = true;
    listRasicRoles(workspaceId)
      .then((roles) => {
        if (active) setWorkspaceRoleNames(roles.map((role) => role.name));
      })
      // A failed load is not worth an error surface: the department and General groups still
      // populate the dropdown, and typing a role still works.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [step.id, workspaceId]);

  useEffect(() => {
    if (step.id !== "overview" || !workspaceId || linkableSops !== undefined) return;
    let cancelled = false;
    listSops(workspaceId)
      .then((items) => {
        if (!cancelled) setLinkableSops(items);
      })
      .catch((error) => {
        if (!cancelled) {
          setLinkableSopsError(error instanceof Error ? error.message : "Could not load workspace SOPs.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [step.id, workspaceId, linkableSops]);

  const stepReviewAnnotations = useMemo(() => {
    const categories = STEP_REVIEW_CATEGORIES[step.id] ?? [];
    return reviewAnnotations.filter((annotation) => categories.includes(annotation.category));
  }, [reviewAnnotations, step.id]);
  const reviewCategoriesNeedingAttention = useMemo(
    () => new Set(reviewAnnotations.map((annotation) => annotation.category)),
    [reviewAnnotations],
  );
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const saveDisabled = !canEdit || !workspaceId || saveStatus === "saving";
  const decisionBranchRequirements = useMemo(
    () => listDecisionBranchRequirements(sop.procedure.activities),
    [sop.procedure.activities],
  );
  const approvalRoutingReady =
    approvalSeats.length > 0 &&
    approvalSeats.every((seat) => Boolean(seat.signerId || seat.nomination)) &&
    !approvalSeats.some(
      (seat) => seat.signerId === approvalAuthorId,
    );
  // A number is earned at release, so the placeholder stands for the whole of authoring and
  // review -- not just until the first save, which is when the number used to be minted.
  const renderedSopNumber = documentNumberLabel(
    sop.meta.sopNumber,
    selectedDept?.code,
    DEFAULT_DOC_TYPE,
  );
  // Until release there is no numeric sequence yet. Keep every rendered document (masthead, PDF
  // preview, and Word export) showing the same placeholder the form shows.
  // Memoized: `sop` identity here is load-bearing for SopPrintPreview's measured pagination — a
  // fresh object every render would re-trigger its offscreen remeasure on every parent render
  // (including the editor's periodic refresh interval), not just on real content changes.
  const renderedSop: Sop = useMemo(
    () => ({
      ...sop,
      meta: { ...sop.meta, version: controlledVersion, sopNumber: renderedSopNumber },
    }),
    [sop, controlledVersion, renderedSopNumber],
  );
  const displaySopNumber = renderedSopNumber;

  useLayoutEffect(() => {
    if (requestedStepIndex >= 0) setStepIndex(requestedStepIndex);
  }, [requestedStepIndex]);

  useLayoutEffect(() => {
    if (contentScrollRef.current) contentScrollRef.current.scrollTop = 0;
  }, [stepIndex]);

  useEffect(() => {
    if (!showFinalApproval) return;
    // Only poll while the tab is visible, matching the SOP list: a backgrounded editor must
    // not keep firing this multi-query refresh every tick. The list's 15s cadence applies here.
    const refresh = () => {
      if (document.visibilityState === "visible") void refreshApprovalRouting({ background: true });
    };
    const interval = window.setInterval(refresh, 15_000);
    return () => window.clearInterval(interval);
  }, [refreshApprovalRouting, showFinalApproval]);

  useEffect(() => {
    if (!showAuditTrail) setAuditPanelOpen(false);
  }, [showAuditTrail]);

  useEffect(() => {
    if (!auditPanelOpen) return;
    // Escape layering, topmost first: referenced-PDF previews (window capture) → the overlay
    // print preview (document capture; it sits above this panel, so the panel yields to it) →
    // this panel (document capture) → an embedded print preview (window bubble, drawn beneath
    // the panel). Each layer consumes the key so exactly one closes.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || previewing) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setAuditPanelOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape, true);
    return () => document.removeEventListener("keydown", closeOnEscape, true);
  }, [auditPanelOpen, previewing]);

  function revealFieldHint(target: EventTarget) {
    const match = getEmptyFieldExample(target);
    if (!match) {
      setFieldHint(null);
      return;
    }
    const rect = match.element.getBoundingClientRect();
    const width = Math.min(288, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const above = window.innerHeight - rect.bottom < 76;
    setFieldHint({ text: match.text, left, top: above ? rect.top - 6 : rect.bottom + 6, above });
  }

  function handleFieldMouseOver(event: MouseEvent<HTMLDivElement>) {
    revealFieldHint(event.target);
  }

  function handleFieldFocus(event: FocusEvent<HTMLDivElement>) {
    revealFieldHint(event.target);
  }

  function handleFieldInput(event: FormEvent<HTMLDivElement>) {
    const target = event.target;
    // Deferred on purpose: this handler runs in the CAPTURE phase of the same native event
    // that drives the field's controlled onChange. When the hint state actually changes
    // (exactly the keystroke that empties a field), a synchronous setState here makes React
    // flush mid-dispatch and restore the input to its rendered value BEFORE the change
    // plugin compares values -- that keystroke's onChange never fires and the last
    // character visibly refuses to delete.
    window.setTimeout(() => revealFieldHint(target), 0);
  }

  /**
   * Add a typed role to the workspace list. The document write already happened through
   * ProcessFlowchart's onChange — this is the shared half of the same gesture, so a failure here
   * must not disturb the document. Optimistic: the name is already selected on screen.
   */
  function handleCreateRasicRole(name: string) {
    if (!workspaceId) return;
    setWorkspaceRoleNames((current) =>
      current.some((role) => role.toLowerCase() === name.toLowerCase()) ? current : [...current, name],
    );
    void addRasicRole(workspaceId, name)
      .then((role) => {
        setWorkspaceRoleNames((current) =>
          current.some((existing) => existing.toLowerCase() === role.name.toLowerCase())
            ? current
            : [...current, role.name],
        );
      })
      .catch(() => {
        // Roll the optimistic entry back out of the dropdown. The role stays on the document,
        // where it renders through the "Current role" fallback.
        setWorkspaceRoleNames((current) => current.filter((role) => role !== name));
      });
  }

  async function handleReloadLatest() {
    const proceed = !dirty || await confirm({
      title: "Reload the latest saved version?",
      body: "This replaces the unsaved changes in this tab with the newest saved copy.",
      tone: "warning",
      confirmLabel: "Reload latest",
      cancelLabel: "Keep editing",
    });
    if (!proceed) return;

    setReloadingLatest(true);
    try {
      const latest = await getSop(sop.id);
      if (!latest) throw new Error("The latest SOP could not be loaded.");
      replaceWithLatest(latest.sop);
      clearUploadStatus();
    } catch (error) {
      reportSaveError(error instanceof Error ? error.message : "Could not reload the latest SOP.");
    } finally {
      setReloadingLatest(false);
    }
  }

  // Confirm in-app exits (shell back link / brand link) while edits are unsaved. The shell
  // awaits this, so an unsaved-changes exit resolves through the themed dialog instead of a
  // native prompt. (Tab close / hard reload still uses the native beforeunload guard below,
  // which browsers require to be synchronous.)
  async function confirmLeave(): Promise<boolean> {
    if (!dirty) return true;
    return confirm({
      title: "Leave without saving?",
      body: "You have unsaved changes that will be lost.",
      tone: "warning",
      confirmLabel: "Leave",
      cancelLabel: "Stay",
    });
  }

  async function handleSaveAndClose() {
    if (await persist()) {
      router.push("/sops");
    }
  }

  async function handleStepSelect(index: number) {
    const nextStep = steps[index];
    if (nextStep?.id === "finalApproval" && finalApprovalLocked) return;
    if (nextStep?.id === "approvals" && !hasPersistedSop && !(await persist())) return;
    setStepIndex(index);
  }

  function openRemarkSection(category: string) {
    const target = REVIEW_CATEGORY_STEPS[category] ?? "document";
    const targetIndex = steps.findIndex((item) => item.id === target);
    if (targetIndex >= 0) void handleStepSelect(targetIndex);
  }

  // Unlock a completed review with feedback on the author's behalf. Never
  // advance to final approval here: that remains an explicit author action.
  const feedbackUnlockAttempt = useRef<string | null>(null);
  useEffect(() => {
    if (submittingForApproval || requestingFinalApproval || !isCurrentUserAuthor || !canEditPermission || approvalRoutingLoading ||
        sop.status !== "in_review" || finalApprovalRequested || !reviewGate.canMakeChanges) return;
    const attempt = `${sop.id}:${approvalReviewCycle}`;
    if (feedbackUnlockAttempt.current === attempt) return;
    feedbackUnlockAttempt.current = attempt;
    setRecallingReview(true);
    clearSaveError();
    void (async () => {
      try {
        const latest = await getSopControl(sop.id);
        if (!latest) throw new Error("The SOP could not be loaded to enable editing.");
        const updated = latest.status === "in_review"
          ? await transitionSop(sop.id, "draft", latest.updatedAt)
          : latest;
        // The workflow transition writes the row too. Advance the save token
        // before enabling editing so autosave does not conflict with our own update.
        adoptWorkflowTransition(updated, sop.id);
      } catch (error) {
        reportSaveError(error instanceof Error ? error.message : "Could not enable editing. Reload to retry.");
      } finally {
        setRecallingReview(false);
      }
    })();
  }, [adoptWorkflowTransition, clearSaveError, reportSaveError, approvalReviewCycle, approvalRoutingLoading, canEditPermission, finalApprovalRequested,
    isCurrentUserAuthor, reviewGate.canMakeChanges, sop.id, sop.status, submittingForApproval, requestingFinalApproval]);

  async function handleStartControlledChange() {
    const reason = controlledChangeReason.trim();
    if (!controlledChangeKind || !reason || startingControlledChange) return;
    setStartingControlledChange(true);
    clearSaveError();
    try {
      const latest = await getSopControl(sop.id);
      if (!latest) throw new Error("The SOP could not be loaded before starting this change.");
      if (latest.status !== "effective") {
        throw new Error("Only an effective SOP can begin an amendment or revision.");
      }

      const transitioned = await transitionSop(sop.id, "draft", latest.updatedAt, {
        revisionReason: reason,
        changeSignificance: controlledChangeKind,
      });
      const refreshed = await getSop(sop.id);
      if (!refreshed) throw new Error("The new controlled draft could not be loaded.");

      beginControlledDraft(refreshed.sop);
      setApprovalReviewCycle(transitioned.reviewCycle);
      setApprovalContentHash(transitioned.contentHash);
      setFinalApprovalRequestedAt(transitioned.finalApprovalRequestedAt);
      setFinalApprovalContentHash(transitioned.finalApprovalContentHash);
      setControlledChangeKind(null);
      setControlledChangeReason("");
      setStepIndex(0);
      window.history.replaceState(
        window.history.state,
        "",
        `/sops/${encodeURIComponent(sop.id)}?step=document`,
      );
      await refreshApprovalRouting({ background: true, force: true });
      setAuditEvents(await listSopAuditEvents(sop.id));
    } catch (error) {
      reportSaveError(error instanceof Error ? error.message : "The controlled change could not be started.");
    } finally {
      setStartingControlledChange(false);
    }
  }

  async function handleMarkRemarkAddressed(annotationId: string, resolved = true) {
    if (resolvingAnnotationId) return;
    setResolvingAnnotationId(annotationId);
    clearSaveError();
    try {
      if (resolved && !(await persist())) return;
      await resolveSopReviewAnnotation(annotationId, resolved);
      const comments = await listSopReviewAnnotations(sop.id);
      setReviewAnnotations(comments.filter((item) => item.reviewCycle === approvalReviewCycle && !item.resolvedAt));
      setAddressedAnnotations(comments.filter((item) => item.reviewCycle === approvalReviewCycle && item.resolvedAt));
      setAuditEvents(await listSopAuditEvents(sop.id));
    } catch (error) {
      reportSaveError(error instanceof Error ? error.message : "The remark could not be marked addressed.");
    } finally {
      setResolvingAnnotationId(null);
    }
  }

  /**
   * Record the author's department choice on the legacy approval row. This is what
   * makes the mapping durable: mapApprovalsToDepartments resolves by departmentCode
   * before falling back to the position title, so the row re-derives as seated
   * instead of reading "No match" forever.
   */
  async function handleMapApproval(approvalIndex: number, departmentCode: string) {
    update((current) => ({
      approvals: current.approvals.map((approval, index) =>
        index === approvalIndex ? { ...approval, departmentCode } : approval,
      ),
    }));
  }

  function adoptSignatureRequest(control: Awaited<ReturnType<typeof requestEditorSignatures>>) {
    adoptWorkflowTransition(control);
    setFinalApprovalRequestedAt(control.finalApprovalRequestedAt);
    setFinalApprovalContentHash(control.finalApprovalContentHash);
    setApprovalContentHash(control.contentHash);
  }

  async function handleRequestFinalApproval() {
    if (requestingFinalApproval || finalApprovalRequested) return;
    setRequestingFinalApproval(true);
    clearSaveError();
    try {
      adoptSignatureRequest(await requestEditorSignatures(sop.id, approvalContentHash ?? "", approvalReviewCycle));
      await refreshApprovalRouting({ force: true });
      setAuditEvents(await listSopAuditEvents(sop.id));
    } catch (error) {
      reportSaveError(error instanceof Error ? error.message : "The SOP could not be sent for final approval.");
    } finally {
      setRequestingFinalApproval(false);
    }
  }

  // Submission is one action from the editor: save the current draft, bind the author's
  // declaration to that exact content, then let the database validate the department roster
  // and move the SOP into draft review. Assigned seat holders see it in their review queue.
  async function handleStartApproval() {
    if (submittingForApproval) return;
    if (decisionBranchRequirements.length > 0) {
      setStepIndex(CREATOR_STEPS.findIndex((creatorStep) => creatorStep.id === "procedure"));
      contentScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    // Single review round: after every reviewer has responded, resubmitting
    // routes to final approval — the remarks must be addressed first.
    if (reviewGate.allResponded && reviewAnnotations.length > 0) {
      reportSaveError("Mark every returned remark as addressed before sending for signatures.");
      return;
    }
    setSubmittingForApproval(true);
    clearSaveError();
    try {
      const submitted = await submitEditorDraft({
        sopId: sop.id, persist, seats: approvalSeats,
        readyForSignatures: reviewGate.allResponded && reviewAnnotations.length === 0,
      });
      if (!submitted) return;
      if (submitted.destination === "final-approval") {
        adoptSignatureRequest(submitted.control);
      } else {
        adoptWorkflowTransition(submitted.control);
      }
      if (submitted.refresh) {
        await refreshApprovalRouting({ background: true, force: true });
        setAuditEvents(await listSopAuditEvents(sop.id));
      }
      setStepIndex(CREATOR_STEPS.length + (submitted.destination === "final-approval" ? 1 : 0));
      window.history.replaceState(window.history.state, "", `/sops/${encodeURIComponent(sop.id)}?step=${submitted.destination}`);
    } catch (error) {
      // Delivery may fail after the review has already started. Adopt that state so retrying
      // sends pending invitations rather than trying to save or submit a frozen draft again.
      const submitted = await getSopControl(sop.id).catch(() => null);
      if (submitted?.status === "in_review") {
        kickSopNotifications();
        adoptWorkflowTransition(submitted);
        await refreshApprovalRouting({ background: true, force: true });
      }
      reportSaveError(error instanceof Error ? error.message : "The SOP could not be sent for review.");
    } finally {
      setSubmittingForApproval(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      // The docx library is heavy and only needed for export — pull it in on demand
      // so it stays out of the editor's initial bundle.
      const { exportFileName, exportSopToDocx } = await import("@/lib/sop/export-docx");
      // The same rows the PDF renders; without them Word would print an empty approvals table.
      const { entries: approvalEntries } = await buildApprovalEntries(sop.id);
      const blob = await exportSopToDocx(renderedSop, approvalEntries);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exportFileName(renderedSop);
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const clearActiveSearchMatch = useCallback(() => {
    clearSopSearchMatch(activeSearchMatchRef.current);
    activeSearchMatchRef.current = null;
  }, []);

  const handleSearchNavigate = useCallback(
    (result: SopSearchResult, query: string, resultIndexInStep: number) => {
      const targetStepIndex = steps.findIndex((entry) => entry.id === result.stepId);
      if (targetStepIndex < 0) return;
      setStepIndex(targetStepIndex);
      clearActiveSearchMatch();

      if (searchRevealTimerRef.current !== null) {
        window.clearTimeout(searchRevealTimerRef.current);
      }
      searchRevealTimerRef.current = window.setTimeout(() => {
        const root = contentScrollRef.current;
        if (!root) return;
        activeSearchMatchRef.current = revealSopSearchMatch({
          root,
          result,
          query,
          resultIndexInStep,
        });
      }, 60);
    },
    [clearActiveSearchMatch, steps],
  );

  useEffect(() => () => {
    if (searchRevealTimerRef.current !== null) {
      window.clearTimeout(searchRevealTimerRef.current);
    }
    clearActiveSearchMatch();
  }, [clearActiveSearchMatch]);

  const actions = (
    <>
      {/* The "fill with sample data" button was removed 2026-08-04. It sat one
          click from the search box, unlabeled and unconfirmed, and overwrote
          the approvals array with five fictional approvers — which no UI can
          edit back out (see approval-entries.ts). Eight production SOPs still
          carry that roster, one of them submitted for review. applySampleData
          survives as a test fixture only (export-docx, procedure-flow-image). */}
      <SopSearch
        sop={renderedSop}
        disabled={previewing || qualityApprovalOpen}
        onNavigate={handleSearchNavigate}
        onClose={clearActiveSearchMatch}
      />
      <button
        type="button"
        className="ui-btn-ghost h-9 w-9 gap-2 px-0 sm:w-auto sm:px-2.5"
        onClick={() => setPreviewing(true)}
        title="Preview the PDF"
        aria-label="Preview the PDF"
      >
        <FileText size={15} />
        <span className="hidden sm:inline">Preview PDF</span>
      </button>
      {showAuditTrail ? (
        <button
          type="button"
          className="ui-btn-ghost h-9 w-9 px-0"
          onClick={() => setAuditPanelOpen((open) => !open)}
          title="Audit trail"
          aria-label="Audit trail"
          aria-expanded={auditPanelOpen}
          aria-controls="sop-audit-panel"
        >
          <History size={15} />
        </button>
      ) : null}
      {sop.status === "effective" ? (
        <button
          type="button"
          className="ui-btn-ghost h-9 w-9 gap-2 px-0 disabled:opacity-50 sm:w-auto sm:px-2.5"
          onClick={handleExport}
          disabled={exporting}
          title="Export to Word (.docx)"
          aria-label={exporting ? "Exporting to Word" : "Export to Word"}
        >
          <Download size={15} />
          <span className="hidden sm:inline">{exporting ? "Exporting…" : "Export"}</span>
        </button>
      ) : null}
    </>
  );

  // One editor per section, shared by the builder steps and the review margin cards.
  const sectionEditors = {
    purpose: (
      <AutoTextarea
        className="ui-field-standalone min-h-20 py-2"
        value={sop.purpose}
        placeholder="Define the purpose of this process"
        disabled={!canEdit}
        onChange={(event) => update({ purpose: event.target.value })}
      />
    ),
    scope: (
      <AutoTextarea
        className="ui-field-standalone min-h-20 py-2"
        value={sop.scope}
        placeholder="For which products, processes or areas this applies"
        disabled={!canEdit}
        onChange={(event) => update({ scope: event.target.value })}
      />
    ),
    definitions: (
      <PairListEditor
        rows={sop.definitions}
        keyLabel="Term"
        valueLabel="Definition"
        keyName="term"
        valueName="definition"
        disabled={!canEdit}
        onChange={(definitions) => update({ definitions })}
      />
    ),
    references: (
      <ReferenceLibraryEditor
        references={sop.references}
        links={sop.linkedSops}
        docs={sop.referenceDocs}
        files={referenceFileByDocId}
        options={(linkableSops ?? []).filter(
          (item) => item.id !== sop.id && item.status === "effective",
        )}
        loading={linkableSops === undefined && !linkableSopsError}
        error={linkableSopsError || referenceDocError}
        disabled={!canEdit}
        uploading={uploadingReferenceDoc}
        onChangeReferences={(references) => update({ references })}
        onChangeLinks={(linkedSops) => update({ linkedSops })}
        onRenameDoc={(id, name) => update({
          referenceDocs: sop.referenceDocs.map((doc) => doc.id === id ? { ...doc, name } : doc),
        })}
        onUpload={(file) => void handleReferenceDocUpload(file)}
        onOpenDoc={(doc) => void handleReferenceDocOpen(doc)}
        onRemoveDoc={(doc) => void handleReferenceDocRemove(doc)}
      />
    ),
    responsible: (
      <ResponsiblePersonsField
        entries={sop.responsiblePersons}
        disabled={!canEdit}
        onChange={(responsiblePersons) => update({ responsiblePersons })}
      />
    ),
    measurements: (
      <StringListEditor
        items={sop.measurements}
        placeholder="e.g. % of released SOPs"
        disabled={!canEdit}
        onChange={(measurements) => update({ measurements })}
      />
    ),
  };

  // --- Draft review: the document with the returned feedback beside it ---
  const openRemarkCount = reviewAnnotations.length;
  const flaggedCategories = Array.from(
    new Set([...reviewAnnotations, ...addressedAnnotations].map((annotation) => annotation.category || "overall")),
  );
  const waitingReviewerCount = draftReviewers.filter((reviewer) => !reviewer.submission).length;
  const startApprovalDisabled =
    saveDisabled ||
    submittingForApproval ||
    approvalRoutingLoading ||
    !approvalRoutingReady ||
    decisionBranchRequirements.length > 0;
  let feedbackAction: {
    label: string;
    icon: ReactNode;
    onClick: () => void;
    disabled?: boolean;
    busy?: boolean;
    title?: string;
  } | null = null;
  let feedbackNote = "";
  if (finalApprovalRequested) {
    feedbackNote = "Sent for signatures. The approvers will find it in their Review queue.";
  } else if (sop.status === "in_review") {
    if (!reviewGate.allResponded) {
      feedbackNote = `Waiting on ${waitingReviewerCount} ${waitingReviewerCount === 1 ? "reviewer" : "reviewers"}.`;
    } else if (openRemarkCount > 0) {
      feedbackNote = recallingReview ? "Preparing changes…" : "All reviews returned.";
    } else {
      feedbackAction = {
        label: requestingFinalApproval ? "Sending…" : "Send for signatures",
        icon: <ShieldCheck size={14} />,
        onClick: () => void handleRequestFinalApproval(),
        busy: requestingFinalApproval,
      };
      feedbackNote = "Every remark is addressed. The approvers sign next.";
    }
  } else if (sop.status === "draft" && canEdit) {
    feedbackAction = {
      label: submittingForApproval ? "Sending…" : reviewGate.allResponded ? "Send for signatures" : "Send for review",
      icon: <ShieldCheck size={14} />,
      onClick: () => void handleStartApproval(),
      disabled: startApprovalDisabled || openRemarkCount > 0,
      busy: submittingForApproval,
      title: openRemarkCount > 0 ? "Address every returned remark first" : undefined,
    };
    feedbackNote =
      openRemarkCount > 0
        ? `${openRemarkCount} ${openRemarkCount === 1 ? "remark" : "remarks"} left to address.`
        : "Every remark is addressed.";
  }

  const pollReviewAnnotations = shouldPollReviewAnnotations({ hasPersistedSop, status: sop.status, hasReviewHistory });
  useEffect(() => {
    if (!pollReviewAnnotations) return;
    let alive = true;
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const comments = await listSopReviewAnnotations(sop.id);
        if (!alive) return;
        setReviewAnnotations(comments.filter(item => item.reviewCycle === approvalReviewCycle && !item.resolvedAt));
        setAddressedAnnotations(comments.filter(item => item.reviewCycle === approvalReviewCycle && item.resolvedAt));
      } finally { pending = false; }
    };
    const run = () => { void refresh().catch(() => { /* Retain the last conversation; retry on the next focus or interval. */ }); };
    const timer = window.setInterval(run, 15000);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", run);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener("focus", run); document.removeEventListener("visibilitychange", run); };
  }, [sop.id, approvalReviewCycle, pollReviewAnnotations]);

  const builderHasFeedback = showDraftReview && step.id !== "draftReview" &&
    [...reviewAnnotations, ...addressedAnnotations].some((remark) =>
      (REVIEW_CATEGORY_STEPS[remark.category] ?? "document") === step.id);
  function builderFeedback(category: string) {
    if (!showDraftReview) return null;
    const matches = (item: SopReviewAnnotation) => item.category === category || (category === "document" && item.category === "overall");
    const remarks = reviewAnnotations.filter(matches);
    const addressed = addressedAnnotations.filter(matches);
    if (!remarks.length && !addressed.length) return null;
    return <SopRemarkCard label={REVIEW_CATEGORY_LABELS[category] ?? category}
      remarks={remarks} addressedRemarks={addressed} hideEditAction
      editor={null} editing={false} editable={canEdit} lockedReason=""
      resolvingId={resolvingAnnotationId} onToggleEdit={() => {}} onOpenInBuilder={() => {}}
      onResolve={(id) => void handleMarkRemarkAddressed(id)}
      onUndo={(id) => void handleMarkRemarkAddressed(id, false)} />;
  }

  function leaveFeedbackView() {
    if (cameFromQueue) {
      router.push(REVIEW_QUEUE_HREF);
      return;
    }
    const draftReviewIndex = steps.findIndex((entry) => entry.id === "draftReview");
    setEditingCategory(null);
    void handleStepSelect(Math.max(0, draftReviewIndex - 1));
  }

  const remarkEditable = sop.status === "draft" && canEdit;
  const remarkLockedReason =
    sop.status === "in_review"
      ? reviewGate.allResponded
        ? ""
        : "You can edit once every reviewer has responded."
      : "";
  const remarkMarginNotes: MarginNote[] = flaggedCategories.map((category) => ({
    key: category,
    category,
    node: (
      <SopRemarkCard
        label={REVIEW_CATEGORY_LABELS[category] ?? "Overall remarks"}
        remarks={reviewAnnotations.filter((annotation) => (annotation.category || "overall") === category)}
        addressedRemarks={addressedAnnotations.filter((item) => item.category === category)}
        onUndo={(id) => void handleMarkRemarkAddressed(id, false)}
        onOpenAttachment={(id) => {
          const file = annexFiles.find((item) => item.annexId === id || item.id === id);
          if (file) { void handleAnnexOpen(file); return; }
          const linked = sop.linkedSops.find((item) => item.sopId === id);
          if (linked) { router.push(`/sops/${encodeURIComponent(id)}?preview=pdf&from=${encodeURIComponent(sop.id)}`); return; }
          reportUnavailableAttachment();
        }}
        editor={sectionEditors[category as keyof typeof sectionEditors] ?? null}
        editing={editingCategory === category}
        editable={remarkEditable}
        lockedReason={remarkLockedReason}
        resolvingId={resolvingAnnotationId}
        onToggleEdit={() => setEditingCategory((current) => (current === category ? null : category))}
        onOpenInBuilder={() => openRemarkSection(category)}
        onResolve={(annotationId) => void handleMarkRemarkAddressed(annotationId)}
      />
    ),
  }));
  const reviewerSummary = draftReviewers
    .map((reviewer) => {
      const state = !reviewer.submission
        ? "reviewing"
        : reviewer.submission.noChanges
          ? "no changes needed"
          : "changes requested";
      return `${reviewer.name}: ${state}`;
    })
    .join(" · ");
  const feedbackToolbar = (
    <>
      {saveError || annexFileError ? <span role="alert" className="max-w-72 text-xs text-danger">{saveError || annexFileError}</span> : null}
      <span className="hidden max-w-[16rem] truncate text-[11px] text-ink-tertiary lg:inline" title={feedbackNote}>
        {feedbackNote}
      </span>
      {feedbackAction ? (
        <button
          type="button"
          className="ui-btn-primary inline-flex h-9 items-center gap-2 px-4 disabled:opacity-40"
          disabled={feedbackAction.disabled || feedbackAction.busy}
          title={feedbackAction.title ?? feedbackNote}
          onClick={feedbackAction.onClick}
        >
          {feedbackAction.busy ? <Loader2 size={14} className="animate-spin" /> : feedbackAction.icon}
          {feedbackAction.label}
        </button>
      ) : null}
    </>
  );

  const sidebar = (
    <>
      <div className="ui-nav-section">SOP Builder</div>
      <div className="space-y-0.5">
        {steps.map((entry, index) => {
          const active = index === stepIndex;
          const issueCount = entry.id === "procedure" ? decisionBranchRequirements.length : 0;
          const hasIssues = issueCount > 0;
          const reviewStep =
            entry.id === "draftReview" || entry.id === "finalApproval" || entry.id === "qualityApproval";
          const firstReviewStepIndex = steps.findIndex(
            (item) =>
              item.id === "draftReview" || item.id === "finalApproval" || item.id === "qualityApproval",
          );
          const filled = entry.id === "approvals"
            ? approvalSeats.length > 0
            : entry.id === "draftReview"
              ? reviewSubmissions.length > 0 || reviewAnnotations.length > 0
              : entry.id === "finalApproval"
                ? allFinalApprovalsSigned
                : entry.id === "qualityApproval"
                  ? sop.status === "effective" || Boolean(qualitySignature)
              : stepFilled(sop, entry.id);
          const locked = entry.id === "finalApproval" && finalApprovalLocked;
          const stepButton = (
            <button
              type="button"
              disabled={locked}
              aria-disabled={locked || undefined}
              className={`ui-nav-item w-full ${
                locked
                  ? "ui-nav-item-idle cursor-not-allowed opacity-50"
                  : hasIssues
                  ? "border border-danger/40 bg-danger-muted text-danger hover:bg-danger-muted"
                  : active
                    ? "ui-nav-item-active"
                    : "ui-nav-item-idle"
              }`}
              onClick={() => void handleStepSelect(index)}
              title={locked ? finalApprovalLockReason : hasIssues ? decisionBranchRequirements[0]?.message : undefined}
              data-has-issues={hasIssues || undefined}
            >
              <SopStepNavIcon
                active={active}
                complete={filled}
                issueCount={issueCount}
                pending={reviewStep}
                number={index + 1}
              />
              <span className="min-w-0 flex-1 truncate text-left">{entry.label}</span>
              {hasIssues ? (
                <span
                  className="inline-flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold leading-4 text-white"
                  aria-hidden="true"
                >
                  {issueCount}
                </span>
              ) : null}
            </button>
          );
          return reviewStep && index === firstReviewStepIndex ? (
            <div key={entry.id} className="mt-3 border-t border-line pt-3">
              <div className="ui-nav-section">Review</div>
              {stepButton}
            </div>
          ) : (
            <div key={entry.id}>{stepButton}</div>
          );
        })}
      </div>
    </>
  );

  function closePreview() {
    if (previewOnly) {
      router.push("/sops");
      return;
    }
    setPreviewing(false);
  }

  if (previewOnly && previewing) {
    return (
      <SopPrintPreview
        sop={renderedSop}
        departmentCode={selectedDept?.code}
        annexFiles={annexFiles}
        onClose={closePreview}
        backLink={previewBackLink}
      />
    );
  }

  if (requestedStepId && requestedStepIndex < 0) {
    if (approvalRoutingError) return <SopShell sidebar={null}><div className="mx-auto max-w-3xl p-5"><p role="alert" className="text-sm text-danger">{approvalRoutingError}</p><button type="button" className="ui-btn-ghost mt-3" onClick={() => void refreshApprovalRouting({ force: true })}>Retry</button></div></SopShell>;
    return <SopDetailLoadingState initialView={initialView} fromReviewQueue={cameFromQueue} />;
  }

  return (
    <SopShell
      crumb={sop.meta.title || sop.meta.sopNumber || "Untitled"}
      actions={actions}
      sidebar={sidebar}
      back={cameFromQueue ? { href: REVIEW_QUEUE_HREF, label: "Review queue" } : { href: "/sops", label: "All SOPs" }}
      confirmLeave={confirmLeave}
      contentRef={contentScrollRef}
    >
      <div
        className="sop-editor"
        onMouseOver={handleFieldMouseOver}
        onMouseOut={() => setFieldHint(null)}
        onFocusCapture={handleFieldFocus}
        onBlurCapture={() => setFieldHint(null)}
        onInputCapture={handleFieldInput}
        onScrollCapture={() => setFieldHint(null)}
      >
        <div className={`mx-auto ${builderHasFeedback ? "max-w-[92rem]" : "max-w-4xl"} ${step.id === "document" ? "" : "pb-16"}`}>
          <div className="min-w-0 space-y-5">

            {showConvertedReview && !reviewDismissed ? (
              <div
                role="status"
                aria-live="polite"
                className={`ui-feedback-toast fixed right-4 top-16 z-[55] flex w-[min(24rem,calc(100vw-2rem))] items-start gap-2 px-3 py-2 transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none ${
                  reviewVisible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
                }`}
              >
                <Sparkles size={14} className="mt-0.5 shrink-0 text-ink-secondary" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium leading-4 text-ink">Review your converted SOP</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-ink-secondary">
                    AI mapped your upload into the standard. Review each section, fix anything that looks off,
                    then send it for review when it is ready. Your changes save automatically.
                  </p>
                </div>
                <button
                  type="button"
                  className="ui-btn-ghost h-6 w-6 shrink-0 px-0 text-ink-tertiary"
                  onClick={dismissReviewToast}
                  title="Dismiss"
                  aria-label="Dismiss review notice"
                >
                  <X size={12} />
                </button>
              </div>
            ) : null}

            {sop.status === "in_review" && approvalSeats.some((seat) => seat.nomination && !seat.nomination.deliveredAt) && (isCurrentUserAuthor || isCurrentUserSubmitter) ? (
              <div className="flex items-center justify-between gap-3 rounded border border-line p-3 text-sm">
                <span>Review started. Approver invitations are pending.</span>
                <button type="button" className="ui-btn-ghost" disabled={submittingForApproval} onClick={async () => {
                  setSubmittingForApproval(true);
                  try { await submitSopWithApproverInvitations(sop.id, sop.updatedAt); await refreshApprovalRouting({ force: true }); reportWorkflowSaved(); }
                  catch (error) { reportSaveError(error instanceof Error ? error.message : "Invitation delivery failed."); }
                  finally { setSubmittingForApproval(false); }
                }}>Retry invitations</button>
              </div>
            ) : null}
            {saveStatus === "error" && saveError ? (
              <div className="ui-notice ui-notice-warn flex items-center gap-3 px-4 py-3 ui-section-subtitle">
                <span className="min-w-0 flex-1">{saveError}</span>
                {conflicted ? (
                  <button
                    type="button"
                    className="ui-btn-ghost h-8 shrink-0 gap-1.5 border border-line px-3"
                    onClick={() => void handleReloadLatest()}
                    disabled={reloadingLatest}
                  >
                    {reloadingLatest ? <Loader2 size={13} className="animate-spin" /> : null}
                    {reloadingLatest ? "Reloading…" : "Reload latest"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ui-btn-ghost h-8 shrink-0 gap-1.5 border border-line px-3"
                    onClick={() => void persist()}
                  >
                    Retry
                  </button>
                )}
              </div>
            ) : null}

            {/* Compact step indicator on mobile */}
            <div className="ui-mono-label text-ink-tertiary sm:hidden">
              Step {stepIndex + 1} of {steps.length} · {step.label}
            </div>

            {step.id === "document" ? (
              <SopDocumentSection
                builderHasFeedback={builderHasFeedback}
                reviewCategoriesNeedingAttention={reviewCategoriesNeedingAttention}
                authMode={authMode}
                persistedUpdatedAt={persistedUpdatedAt}
                canEdit={canEdit}
                deptId={deptId}
                setDeptId={setDeptId}
                selectedDept={selectedDept}
                displaySopNumber={displaySopNumber}
                sop={sop}
                update={update}
                controlledVersion={controlledVersion}
                approvalReviewCycle={approvalReviewCycle}
                navigation={<div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="ui-btn-ghost h-9 gap-1.5 px-3 disabled:opacity-40"
                        disabled={isFirst}
                        onClick={() => void handleStepSelect(Math.max(0, stepIndex - 1))}
                      >
                        <ChevronLeft size={14} />
                        Back
                      </button>
                      {showDraftReview && stepReviewAnnotations.length > 0 ? (
                        <button
                          type="button"
                          className="ui-btn-ghost h-9 gap-1.5 px-3"
                          onClick={() => void handleStepSelect(steps.findIndex((item) => item.id === "draftReview"))}
                        >
                          <MessageSquare size={14} />
                          Back to Draft Review
                        </button>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="ui-btn-ghost h-9 gap-1.5 px-4 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={nextStepLocked}
                      title={nextStepLocked ? finalApprovalLockReason : undefined}
                      onClick={() => void handleStepSelect(Math.min(steps.length - 1, stepIndex + 1))}
                    >
                      Next
                      <ChevronRight size={14} />
                    </button>
                  </div>}
                builderFeedback={builderFeedback}
              />
            ) : null}

            {step.id === "overview" ? (
              <SopOverviewSection
                builderHasFeedback={builderHasFeedback}
                builderFeedback={builderFeedback}
                reviewCategoriesNeedingAttention={reviewCategoriesNeedingAttention}
                sectionEditors={sectionEditors}
              />
            ) : null}

            {step.id === "procedure" ? (
              <SopProcedureSection
                builderHasFeedback={builderHasFeedback}
                builderFeedback={builderFeedback}
                reviewCategoriesNeedingAttention={reviewCategoriesNeedingAttention}
                sectionEditors={sectionEditors}
                sop={sop}
                canEdit={canEdit}
                update={update}
                approvalDepartments={approvalDepartments}
                selectedDepartmentId={selectedDepartmentId}
                workspaceRoleNames={workspaceRoleNames}
                handleCreateRasicRole={handleCreateRasicRole}
              />
            ) : null}

            {step.id === "annexes" ? (
              <>
                <Section title="Annexes & forms" reserveMargin={builderHasFeedback} feedback={builderFeedback("annexes")} reviewAttention={reviewCategoriesNeedingAttention.has("annexes")}>
                  <AnnexesEditor
                    sopId={sop.id}
                    rows={sop.annexes}
                    files={annexFiles}
                    disabled={!canEdit}
                    uploadingAnnexId={uploadingAnnexId}
                    uploadStatus={annexUploadStatus}
                    onChange={(changeAnnexes) =>
                      update((current) => ({ annexes: changeAnnexes(current.annexes) }))
                    }
                    onUpload={handleAnnexUpload}
                    onOpen={(file) => void handleAnnexOpen(file)}
                    onRename={handleAnnexRename}
                    onRemoveFile={(file) => void handleAnnexFileRemove(file)}
                    onRemoveRow={(index) => void handleAnnexRowRemove(index)}
                  />
                  {annexFileError ? <p className="mt-2 text-xs text-danger">{annexFileError}</p> : null}
                </Section>
                <Section title="Change history" reserveMargin={builderHasFeedback} feedback={builderFeedback("history")} reviewAttention={reviewCategoriesNeedingAttention.has("history")}>
                  <SystemChangeHistory rows={sop.changeHistory} />
                </Section>
              </>
            ) : null}

            {step.id === "approvals" ? (
              <SopApprovalsSection
                approvalRoutingError={approvalRoutingError}
                approvalRoutingLoading={approvalRoutingLoading}
                hasPersistedSop={hasPersistedSop}
                canEdit={canEdit}
                sop={sop}
                approvalAuthorId={approvalAuthorId}
                approvalDepartments={approvalDepartments}
                approvalSeats={approvalSeats}
                approvalMyDeptRoles={approvalMyDeptRoles}
                selectedDepartmentId={selectedDepartmentId}
                handleMapApproval={handleMapApproval}
                refreshApprovalRouting={refreshApprovalRouting}
              />
            ) : null}

            {step.id === "draftReview" ? (
              <SopPrintPreview
                sop={renderedSop}
                departmentCode={selectedDept?.code}
                annexFiles={annexFiles}
                mode="review"
                taskLabel="Address feedback"
                toolbarNote={reviewerSummary || "Edit the flagged sections and mark comments addressed."}
                highlightRemarks={reviewAnnotations}
                marginNotes={remarkMarginNotes}
                embedded
                toolbarActions={feedbackToolbar}
                onClose={leaveFeedbackView}
              />
            ) : null}

            {step.id === "finalApproval" ? (
              <SopPrintPreview
                sop={renderedSop}
                departmentCode={selectedDept?.code}
                annexFiles={annexFiles}
                mode="approval"
                taskLabel="Signatures"
                toolbarNote={finalApprovalRequested ? "Approvers sign next, then Quality verifies and releases the SOP." : "Complete draft review and send for signatures."}
                embedded
                onClose={leaveFeedbackView}
                marginNotes={[{
                  key: "signature-status",
                  category: "document",
                  node: <section className="space-y-3">
                    <p className="text-[11px] font-medium text-ink-secondary">Required signatures</p>
                    {finalApprovalStakeholders.map(({ seat, department, name, signature }) => (
                      <div key={seat.departmentId} className="flex items-center gap-2 border-b border-line pb-3 last:border-0">
                        <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${signature ? "bg-accent" : "bg-ink-tertiary"}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-ink">{name}</p>
                          <p className="text-[11px] text-ink-tertiary">{department?.name ?? "Department approver"}</p>
                        </div>
                        <span className="text-[11px] text-ink-secondary">{signature ? "Signed" : finalApprovalRequested ? "Awaiting signature" : "Not requested"}</span>
                      </div>
                    ))}
                  </section>,
                }]}
              />
            ) : null}

            {step.id === "qualityApproval" ? (
              <SopQualitySection
                sop={sop}
                qualitySignature={qualitySignature}
                isCurrentUserAuthor={isCurrentUserAuthor}
                canEditPermission={canEditPermission}
                controlledChangeKind={controlledChangeKind}
                setControlledChangeKind={setControlledChangeKind}
                handleStartControlledChange={handleStartControlledChange}
                controlledChangeReason={controlledChangeReason}
                setControlledChangeReason={setControlledChangeReason}
                startingControlledChange={startingControlledChange}
                setPreviewing={setPreviewing}
                isCurrentUserQualityApprover={isCurrentUserQualityApprover}
                setQualityApprovalOpen={setQualityApprovalOpen}
              />
            ) : null}

            {/* Footer nav */}
            {step.id !== "document" ? (
              <div className="flex flex-col gap-2 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="ui-btn-ghost h-9 gap-1.5 px-3 disabled:opacity-40"
                  disabled={isFirst}
                  onClick={() => void handleStepSelect(Math.max(0, stepIndex - 1))}
                >
                  <ChevronLeft size={14} />
                  Back
                </button>
                {showDraftReview &&
                stepReviewAnnotations.length > 0 &&
                CREATOR_STEPS.some((creatorStep) => creatorStep.id === step.id) ? (
                  <button
                    type="button"
                    className="ui-btn-ghost h-9 gap-1.5 px-3"
                    onClick={() => void handleStepSelect(steps.findIndex((item) => item.id === "draftReview"))}
                  >
                    <MessageSquare size={14} />
                    Back to Draft Review
                  </button>
                ) : null}
              </div>
              {isLast ? (
                <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
                  {canEdit ? (
                    <>
                      <button
                        type="button"
                        className="ui-btn-ghost h-9 gap-1.5 whitespace-nowrap px-4 disabled:opacity-50"
                        onClick={handleSaveAndClose}
                        disabled={saveDisabled}
                        title="Save this draft and return to the SOP list"
                      >
                        <Check size={14} />
                        {saveStatus === "saving" ? "Saving…" : "Save & close"}
                      </button>
                      <button
                        type="button"
                        className="ui-btn-primary h-9 gap-1.5 whitespace-nowrap px-4 disabled:opacity-50"
                        onClick={handleStartApproval}
                        disabled={
                          saveDisabled ||
                          submittingForApproval ||
                          approvalRoutingLoading ||
                          !approvalRoutingReady ||
                          decisionBranchRequirements.length > 0
                        }
                        title={
                          decisionBranchRequirements[0]?.message ?? (approvalRoutingReady
                            ? reviewGate.allResponded
                              ? "The review round is complete — save this draft and send it to the formal approvers for signature"
                              : "Save this draft and send it to every required departmental approver"
                            : "Assign at least one required departmental approver who is not the SOP author")
                        }
                      >
                        <ShieldCheck size={14} />
                        {submittingForApproval
                          ? "Sending…"
                          : saveStatus === "saving"
                            ? "Saving…"
                            : reviewGate.allResponded
                              ? "Send for signatures"
                              : "Send for review"}
                      </button>
                    </>
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  className="ui-btn-ghost h-9 gap-1.5 px-4 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={nextStepLocked}
                  title={nextStepLocked ? finalApprovalLockReason : undefined}
                  onClick={() => void handleStepSelect(Math.min(steps.length - 1, stepIndex + 1))}
                >
                  Next
                  <ChevronRight size={14} />
                </button>
              )}
              </div>
            ) : null}
        </div>
      </div>
      </div>
        {showAuditTrail ? (
          <aside
            id="sop-audit-panel"
            role="dialog"
            aria-modal="false"
            aria-label="SOP audit trail"
            aria-hidden={!auditPanelOpen}
            className={`fixed bottom-0 right-0 top-12 z-[60] flex w-[min(28rem,calc(100vw-1rem))] flex-col border-l border-line bg-surface-raised shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none ${
              auditPanelOpen ? "translate-x-0" : "pointer-events-none translate-x-full"
            }`}
          >
              <div className="flex flex-none items-start justify-between gap-4 border-b border-line px-5 py-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-subtle text-ink-secondary">
                    <History size={15} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="ui-setup-section-title">Audit trail</h2>
                      <span className="ui-chip tabular-nums">{auditEvents.length}</span>
                    </div>
                    <p className="mt-1 text-xs leading-4 text-ink-tertiary">
                      Immutable review and workflow events.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="ui-btn-ghost h-8 w-8 shrink-0 p-0"
                  onClick={() => setAuditPanelOpen(false)}
                  disabled={!auditPanelOpen}
                  tabIndex={auditPanelOpen ? 0 : -1}
                  aria-label="Close audit trail"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {auditEvents.length ? (
                  <div className="divide-y divide-line">
                    {auditEvents.map((event) => (
                      <div key={event.id} className="flex items-start gap-3 px-5 py-3.5">
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ink-tertiary" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-ink">
                            {AUDIT_EVENT_LABELS[event.eventType] ?? event.eventType.replaceAll("_", " ")}
                          </p>
                          <p className="mt-1 text-[11px] leading-4 text-ink-tertiary">
                            {event.actorName || "System"} · Review cycle {event.reviewCycle + 1}
                          </p>
                        </div>
                        <span className="shrink-0 text-[11px] tabular-nums text-ink-tertiary">
                          {formatDate(event.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : auditError ? (
                  <p className="px-5 py-10 text-center text-xs text-red-600">{auditError}</p>
                ) : (
                  <p className="px-5 py-10 text-center text-xs leading-5 text-ink-tertiary">
                    Workflow events will appear here as this SOP moves through review.
                  </p>
                )}
              </div>
          </aside>
        ) : null}
        {fieldHint ? (
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[70] w-max max-w-72 rounded-md border border-line bg-surface-raised px-2.5 py-1.5 text-[11px] leading-4 text-ink-secondary shadow-lg"
            style={{
              left: fieldHint.left,
              top: fieldHint.top,
              transform: fieldHint.above ? "translateY(-100%)" : undefined,
            }}
          >
            Example: <span className="font-medium text-ink">{fieldHint.text}</span>
          </div>
        ) : null}
        {previewing ? (
          <SopPrintPreview
            sop={renderedSop}
            departmentCode={selectedDept?.code}
            annexFiles={annexFiles}
            onClose={closePreview}
          />
        ) : null}
        {referencePreview ? (
          <ReferencePdfPreview {...referencePreview} onClose={() => closeReferencePreview()} />
        ) : null}
        {qualityApprovalOpen ? (
          <SopQualityApprovalWorkspace
            sopId={sop.id}
            onClose={() => setQualityApprovalOpen(false)}
            onReleased={() => void refreshApprovalRouting({ background: true, force: true })}
            returnLabel="Back to Quality Approval"
          />
        ) : null}
      </SopShell>
  );
}
