"use client";

import { Check, ChevronLeft, ChevronRight, CircleCheck, Download, FileText, History, Loader2, MessageSquare, Paperclip, Plus, RotateCcw, ShieldCheck, Sparkles, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
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
import { ThemedSelect } from "@/components/themed-select";
import type { Department } from "@/domain/departments";
import {
  initialDraftChangeEntry,
  lifecycleChangeEntry,
  sameChangeEntry,
  type SopChangeActor,
} from "@/domain/sop/change-history";
import { draftReviewGate } from "@/domain/sop/review-gate";
import { linkedSopLabel, rasicLegend, SOP_STATUS_LABELS, type Sop, type SopLinkedSop, type SopReferenceDoc, type SopStatus } from "@/domain/sop/schema";
import { authoringMode, DEFAULT_DOC_TYPE, previewSopNumber } from "@/domain/sop/authoring";
import { applySampleData } from "@/domain/sop/sample";
import { createPlannerSupabaseClient, getUserFromSession } from "@/domain/supabase-planner";
import { fetchMyDeptRoles, listDepartments, listMembersForDepartments } from "@/lib/departments/store";
import {
  getSopControl,
  isBlockingSeat,
  isSignatureCurrent,
  listSeats,
  listSignatures,
  listProfileNames,
  mintSopNumber,
  requestSopFinalApproval,
  signSop,
  transitionSop,
  type SopReviewSeat,
  type SopSignature,
} from "@/lib/sop/review";
import { getSop, listSops, saveSop, SopConflictError, type SaveSopOptions, type SopListItem } from "@/lib/sop/store";
import {
  listSopReviewAnnotations,
  listSopReviewSubmissions,
  resolveSopReviewAnnotation,
  type SopReviewAnnotation,
  type SopReviewSubmission,
} from "@/lib/sop/review-annotations";
import { listSopAuditEvents, type SopAuditEvent } from "@/lib/sop/audit-events";
import type { SopApprovalRoutingInitialData } from "@/lib/sop/detail-data";
import {
  listSopAnnexFiles,
  openSopAnnexFile,
  removeSopAnnexFile,
  SOP_ANNEX_FILE_ACCEPT,
  uploadSopAnnexFile,
  type SopAnnexFile,
} from "@/lib/sop/annex-files";
import { SopShell } from "./sop-shell";
import { AutoTextarea } from "./auto-textarea";
import { ProcessFlowchart } from "./process-flowchart";
import { SopDetailLoadingState } from "./sop-detail-loading-state";
import { SopPrintPreview } from "./sop-print-preview";
import { SopQualityApprovalWorkspace } from "./sop-quality-approval-workspace";
import { SopRosterEditor } from "./sop-roster-editor";

type StepId =
  | "document"
  | "overview"
  | "procedure"
  | "annexes"
  | "approvals"
  | "draftReview"
  | "finalApproval"
  | "qualityApproval";

export type SopEditorInitialView = "pdf" | "draft-review" | "final-approval" | "quality-approval";

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
      );
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

type SaveStatus = "idle" | "saving" | "saved" | "error";
type SopPatch = Partial<Sop> | ((current: Sop) => Partial<Sop>);

type AnnexUploadStatus = {
  annexId: string;
  phase: "saving" | "uploading" | "success" | "error";
  message: string;
};

/** Debounce for autosave: persist this long after the last edit settles. */
const AUTOSAVE_DELAY_MS = 2000;

function newAnnexId(sopId: string): string {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${sopId}-annex-${suffix}`;
}
function formatReviewDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

function withAnnexIds(sop: Sop): Sop {
  return {
    ...sop,
    // Documents authored before the linked-SOPs / reference-docs features (e.g.
    // restored local drafts) may lack the keys entirely; the editor requires arrays.
    linkedSops: Array.isArray(sop.linkedSops) ? sop.linkedSops : [],
    referenceDocs: Array.isArray(sop.referenceDocs) ? sop.referenceDocs : [],
    annexes: sop.annexes.map((annex, index) => ({
      ...annex,
      id: annex.id || `${sop.id}-annex-${index}`,
    })),
  };
}

function newReferenceDocId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `refdoc-${crypto.randomUUID()}`
    : `refdoc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

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

type DepartmentAuthorIdentity = SopChangeActor & { departmentId: string; userId: string };

async function loadDepartmentAuthorIdentity(departmentId: string): Promise<DepartmentAuthorIdentity> {
  const supabase = createPlannerSupabaseClient();
  const userResult = await getUserFromSession(supabase);
  const user = userResult.data.user;
  if (!user?.id) throw new Error("Your session expired. Sign in again before saving this SOP.");

  const [profileNames, members] = await Promise.all([
    listProfileNames([user.id]),
    listMembersForDepartments([departmentId]),
  ]);
  const metadataName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "";
  const member = members.find((candidate) => candidate.departmentId === departmentId && candidate.userId === user.id);

  return {
    departmentId,
    userId: user.id,
    name: profileNames.get(user.id)?.trim() || metadataName || user.email?.trim() || "Department author",
    position: member?.positionTitle.trim() || "Department Author",
  };
}

function appendMissingChangeEntries(
  rows: Sop["changeHistory"],
  entries: Sop["changeHistory"],
): Sop["changeHistory"] {
  return entries.reduce(
    (current, entry) => current.some((candidate) => sameChangeEntry(candidate, entry)) ? current : [...current, entry],
    rows,
  );
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
  const previewBackLink = previewBackSopId
    ? { href: `/sops/${encodeURIComponent(previewBackSopId)}?preview=pdf`, label: "Back" }
    : undefined;
  const confirm = useConfirm();
  const [sop, setSop] = useState<Sop>(() => withAnnexIds(initial));
  const canEdit = canEditPermission && sop.status === "draft";
  // Owning-department selection for a new SOP (undefined mode => not the create flow).
  const authMode = isNew && authoringDepartments ? authoringMode(authoringDepartments) : null;
  const [deptId, setDeptId] = useState<string>(() => {
    if (authMode?.kind === "single") return authMode.department.id;
    if (authMode?.kind === "choose") return authMode.departments[0]?.id ?? "";
    return "";
  });
  const selectedDept = owningDepartment ?? authoringDepartments?.find((d) => d.id === deptId) ?? null;
  const selectedDepartmentId = selectedDept?.id ?? "";
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const [reloadingLatest, setReloadingLatest] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [previewing, setPreviewing] = useState(initialView === "pdf");
  const [previewOnly] = useState(initialView === "pdf");
  const [qualityApprovalOpen, setQualityApprovalOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const [showConvertedReview, setShowConvertedReview] = useState(false);
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const [reviewVisible, setReviewVisible] = useState(false);
  const [fieldHint, setFieldHint] = useState<FieldHint | null>(null);
  const [annexFiles, setAnnexFiles] = useState<SopAnnexFile[]>([]);
  const [annexFileError, setAnnexFileError] = useState("");
  // Workspace SOPs offered by the References picker; loaded lazily on the overview step.
  const [linkableSops, setLinkableSops] = useState<SopListItem[] | undefined>(undefined);
  const [linkableSopsError, setLinkableSopsError] = useState("");
  const [referenceDocError, setReferenceDocError] = useState("");
  const [uploadingReferenceDoc, setUploadingReferenceDoc] = useState(false);
  const [uploadingAnnexId, setUploadingAnnexId] = useState<string | null>(null);
  const [annexUploadStatus, setAnnexUploadStatus] = useState<AnnexUploadStatus | null>(null);
  const [approvalDepartments, setApprovalDepartments] = useState<Department[]>(
    () => initialApprovalRouting?.departments ?? [],
  );
  const [departmentAuthorIdentity, setDepartmentAuthorIdentity] = useState<DepartmentAuthorIdentity | null>(null);
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
  const [isCurrentUserQualityApprover, setIsCurrentUserQualityApprover] = useState(
    () => {
      if (!initialApprovalRouting) return false;
      const roles = new Map(initialApprovalRouting.departmentRoles);
      return initialApprovalRouting.departments.some(
        (department) => department.isQualityGate && roles.get(department.id) === "approver",
      );
    },
  );
  const [approvalRoutingLoading, setApprovalRoutingLoading] = useState(false);
  const [approvalRoutingError, setApprovalRoutingError] = useState("");
  const [reviewAnnotations, setReviewAnnotations] = useState<SopReviewAnnotation[]>(
    () => initialApprovalRouting?.reviewAnnotations ?? [],
  );
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
  const [submittingForApproval, setSubmittingForApproval] = useState(false);
  // Edits since the last successful save -- drives the leave guards and autosave.
  const [dirty, setDirty] = useState(false);
  // A save lost the concurrency check: freeze autosave so we never loop against the conflict.
  const [conflicted, setConflicted] = useState(false);
  // Optimistic-concurrency token: the updated_at loaded with the SOP (undefined until the
  // first insert), refreshed from every save response so consecutive saves keep working.
  const [persistedUpdatedAt, setPersistedUpdatedAt] = useState<string | undefined>(
    isNew ? undefined : initial.updatedAt,
  );
  // Mirror of the concurrency token read by persist(): an in-flight save advances it
  // synchronously (before its promise resolves), so a click that awaited that save reads the
  // fresh token here rather than this closure's stale state copy.
  const persistedUpdatedAtRef = useRef<string | undefined>(isNew ? undefined : initial.updatedAt);
  // Bumped on every user edit so a save that raced with typing doesn't clobber newer edits.
  const editVersionRef = useRef(0);
  const persistedAnnexIdsRef = useRef(
    new Set(withAnnexIds(initial).annexes.flatMap((annex) => (annex.id ? [annex.id] : []))),
  );
  const seededInitialHistoryRef = useRef<Sop["changeHistory"][number] | null>(null);
  // The edit version reflected in this render's `sop`. persist() closes over this snapshot
  // rather than reading the ref when it runs: a stale autosave timer can fire after a
  // keystroke but before its effect cleanup cancels it, and reading the ref at call time
  // would count that keystroke as "already saved" -- the server copy of the older text
  // would then be adopted, resurrecting the deleted characters.
  const sopEditVersion = editVersionRef.current;
  // Blocks overlapped saves from the same timer-vs-cleanup gap; a second in-flight save
  // would reuse the same expectedUpdatedAt and land as a false concurrency conflict.
  const saveInFlightRef = useRef(false);
  // Handle to the save currently running, so a click that races an autosave can await it
  // instead of being silently dropped (persist returned false while a save was in flight).
  const inFlightSaveRef = useRef<Promise<boolean> | null>(null);
  const reviewDismissTimerRef = useRef<number | null>(null);
  const skipInitialApprovalFetchRef = useRef(Boolean(initialApprovalRouting));
  const skipInitialReviewFetchRef = useRef(Boolean(initialApprovalRouting));
  const skipInitialAuditFetchRef = useRef(Boolean(initialApprovalRouting));
  // The status as last persisted -- a save that changes it auto-appends a changeHistory row.
  const lastSavedStatusRef = useRef<SopStatus>(initial.status);
  const hasPersistedSop = !isNew || Boolean(persistedUpdatedAt);

  const refreshApprovalRouting = useCallback(async (options: { background?: boolean } = {}) => {
    if (!workspaceId) return;
    if (!options.background) setApprovalRoutingLoading(true);
    setApprovalRoutingError("");
    try {
      const supabase = createPlannerSupabaseClient();
      const [departments, seats, signatures, control, userResult, departmentRoles] = await Promise.all([
        listDepartments(workspaceId),
        hasPersistedSop ? listSeats(sop.id) : Promise.resolve([] as SopReviewSeat[]),
        hasPersistedSop ? listSignatures(sop.id) : Promise.resolve([] as SopSignature[]),
        hasPersistedSop ? getSopControl(sop.id) : Promise.resolve(undefined),
        getUserFromSession(supabase),
        fetchMyDeptRoles(workspaceId),
      ]);
      const reviewerNames = await listProfileNames(
        seats.flatMap((seat) => seat.signerId ? [seat.signerId] : []),
      );
      setApprovalDepartments(departments);
      setApprovalSeats(seats.filter((seat) => isBlockingSeat(seat.rasic)));
      setApprovalSignatures(signatures);
      setApprovalReviewerNames(reviewerNames);
      setApprovalAuthorId(control?.createdBy ?? null);
      setApprovalReviewCycle(control?.reviewCycle ?? 0);
      setApprovalContentHash(control?.contentHash ?? null);
      setFinalApprovalRequestedAt(control?.finalApprovalRequestedAt ?? null);
      setFinalApprovalContentHash(control?.finalApprovalContentHash ?? null);
      setIsCurrentUserAuthor(Boolean(control?.createdBy && control.createdBy === userResult.data.user?.id));
      setIsCurrentUserQualityApprover(
        departments.some(
          (department) => department.isQualityGate && departmentRoles.get(department.id) === "approver",
        ),
      );
      if (control) {
        setSop((current) => current.status === control.status ? current : { ...current, status: control.status });
      }
    } catch (error) {
      setApprovalRoutingError(error instanceof Error ? error.message : "Could not load approval routing.");
    } finally {
      if (!options.background) setApprovalRoutingLoading(false);
    }
  }, [hasPersistedSop, sop.id, workspaceId]);

  useEffect(() => {
    if (skipInitialApprovalFetchRef.current) {
      skipInitialApprovalFetchRef.current = false;
      return;
    }
    void refreshApprovalRouting();
  }, [refreshApprovalRouting]);

  useEffect(() => {
    if (!selectedDepartmentId) {
      setDepartmentAuthorIdentity(null);
      return;
    }

    let active = true;
    setDepartmentAuthorIdentity(null);
    void loadDepartmentAuthorIdentity(selectedDepartmentId)
      .then((identity) => {
        if (active) setDepartmentAuthorIdentity(identity);
      })
      .catch(() => {
        if (active) setDepartmentAuthorIdentity(null);
      });
    return () => {
      active = false;
    };
  }, [selectedDepartmentId]);

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
        // Cycle-scoped, NOT hash-scoped: the draft review is a single round per
        // cycle, so verdicts stay valid after the author recalls and edits.
        setReviewSubmissions(
          submissions.filter((submission) => submission.reviewCycle === approvalReviewCycle),
        );
      })
      .catch(() => {
        if (!active) return;
        setReviewAnnotations([]);
        setReviewSubmissions([]);
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
  const requestedStepId: StepId | null = initialView === "draft-review"
    ? "draftReview"
    : initialView === "final-approval"
      ? "finalApproval"
      : initialView === "quality-approval"
        ? "qualityApproval"
        : null;
  const requestedStepIndex = requestedStepId
    ? steps.findIndex((entry) => entry.id === requestedStepId)
    : -1;
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
  const step = steps[stepIndex] ?? steps[0];

  // Load the workspace SOP list the first time the overview step (which hosts the
  // References picker) becomes active; undefined = not loaded yet.
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

  // Reference-doc uploads share the annex-file table (keyed by the reference row's id
  // in the annex_id slot); this map serves the References UI's open/remove actions.
  const referenceFileByDocId = useMemo(
    () => new Map(annexFiles.map((file) => [file.annexId, file] as const)),
    [annexFiles],
  );

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
  const approvalRoutingReady =
    approvalSeats.length > 0 &&
    approvalSeats.every((seat) => Boolean(seat.signerId)) &&
    !approvalSeats.some(
      (seat) => seat.signerId === approvalAuthorId,
    );
  const provisionalSopNumber =
    isNew && !persistedUpdatedAt && selectedDept
      ? previewSopNumber(selectedDept.code, DEFAULT_DOC_TYPE)
      : null;
  // Version is lifecycle-owned: a new SOP is always 1.0 and only the database's
  // effective -> draft revision transition may increment it. Never trust typed/imported text.
  const controlledVersion = approvalReviewCycle > 0
    ? /^\d+\.\d+$/.test(sop.meta.version.trim())
      ? sop.meta.version.trim()
      : `1.${approvalReviewCycle}`
    : "1.0";

  useEffect(() => {
    if (
      !isNew ||
      persistedUpdatedAt ||
      !selectedDepartmentId ||
      departmentAuthorIdentity?.departmentId !== selectedDepartmentId
    ) {
      return;
    }

    const entry = initialDraftChangeEntry(controlledVersion, departmentAuthorIdentity);
    const previousSeed = seededInitialHistoryRef.current;
    setSop((current) => {
      const canSeed = current.changeHistory.length === 0;
      const canRefreshSeed = Boolean(
        previousSeed &&
        current.changeHistory.length === 1 &&
        sameChangeEntry(current.changeHistory[0], previousSeed),
      );
      if (!canSeed && !canRefreshSeed) return current;
      seededInitialHistoryRef.current = entry;
      return { ...current, changeHistory: [entry] };
    });
  }, [controlledVersion, departmentAuthorIdentity, isNew, persistedUpdatedAt, selectedDepartmentId]);

  // Before the first save there is no numeric sequence yet. Keep every rendered document
  // (masthead, PDF preview, and Word export) aligned with the provisional number in the form.
  const renderedSop: Sop = {
    ...sop,
    meta: {
      ...sop.meta,
      version: controlledVersion,
      ...(provisionalSopNumber ? { sopNumber: provisionalSopNumber } : {}),
    },
  };
  const displaySopNumber = /^<unknown>$/i.test(renderedSop.meta.sopNumber.trim())
    ? "Unnumbered"
    : renderedSop.meta.sopNumber || "—";

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
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAuditPanelOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [auditPanelOpen]);

  function update(patch: SopPatch) {
    setSop((current) => ({
      ...current,
      ...(typeof patch === "function" ? patch(current) : patch),
    }));
    editVersionRef.current += 1;
    setDirty(true);
    setSaveStatus("idle");
  }

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

  // Persist the current SOP, returning whether it succeeded. Callers that navigate or export
  // gate on the boolean so a failed save never silently drops the user's work.
  async function persist(): Promise<boolean> {
    if (!canEdit || !workspaceId) {
      setSaveError(workspaceId ? "You do not have permission to save this SOP." : "Select an organization before saving.");
      setSaveStatus("error");
      return false;
    }

    // A save (typically an autosave that a keystroke re-enabled the buttons over) may already be
    // running. Wait for it to settle, then fall through to one fresh save so this click captures
    // the latest edits against the up-to-date token -- never a silent no-op. The loop also
    // serializes two clicks that both awaited the same in-flight save. saveInFlightRef and
    // inFlightSaveRef are always set together, so this can't spin on a null promise.
    while (saveInFlightRef.current) {
      try {
        await inFlightSaveRef.current;
      } catch {
        // The in-flight save reported its own outcome; attempt a fresh save regardless.
      }
    }

    // First save of a new SOP: the owning department mints the number (and is written on INSERT).
    // Read the token from the ref: a save we just awaited advances it synchronously, while this
    // closure's `persistedUpdatedAt` would still show the pre-save value.
    const expectedUpdatedAt = persistedUpdatedAtRef.current;
    const firstSave = isNew && !expectedUpdatedAt;
    if (firstSave && !deptId) {
      setSaveError("Choose an owning department before saving.");
      setSaveStatus("error");
      return false;
    }

    setSaveStatus("saving");
    setSaveError("");
    saveInFlightRef.current = true;
    const run = runSave(firstSave, expectedUpdatedAt);
    inFlightSaveRef.current = run;
    return run;
  }

  async function runSave(firstSave: boolean, expectedUpdatedAt: string | undefined): Promise<boolean> {
    try {
      const needsAuthorIdentity = firstSave || sop.status !== lastSavedStatusRef.current;
      let savingAuthorIdentity = departmentAuthorIdentity;
      if (
        needsAuthorIdentity &&
        selectedDepartmentId &&
        savingAuthorIdentity?.departmentId !== selectedDepartmentId
      ) {
        try {
          savingAuthorIdentity = await loadDepartmentAuthorIdentity(selectedDepartmentId);
          setDepartmentAuthorIdentity(savingAuthorIdentity);
        } catch (error) {
          setSaveError(error instanceof Error ? error.message : "Could not load the department author's information.");
          setSaveStatus("error");
          return false;
        }
      }

      let working: Sop = { ...sop, meta: { ...sop.meta, version: controlledVersion } };
      const saveOptions: SaveSopOptions = { expectedUpdatedAt };
      if (firstSave) {
        try {
          // A failed INSERT can be retried with the number already reserved by the first mint.
          // Re-minting here would create a gap every time a transient save error is retried.
          const reservedNumber = sop.meta.sopNumber.trim();
          const minted = reservedNumber || (await mintSopNumber(workspaceId!, deptId, DEFAULT_DOC_TYPE));
          working = { ...working, meta: { ...working.meta, sopNumber: minted } };
          // Patch only the number: edits typed while the mint was in flight must survive.
          setSop((current) => ({ ...current, meta: { ...current.meta, sopNumber: minted } }));
          saveOptions.departmentId = deptId;
          saveOptions.docType = DEFAULT_DOC_TYPE;
        } catch (error) {
          setSaveError(error instanceof Error ? error.message : "Could not assign a SOP number.");
          setSaveStatus("error");
          return false;
        }
      }

      const statusChanged = working.status !== lastSavedStatusRef.current;
      const generatedHistoryEntries: Sop["changeHistory"] = [];
      if (firstSave && working.changeHistory.length === 0 && savingAuthorIdentity) {
        generatedHistoryEntries.push(initialDraftChangeEntry(controlledVersion, savingAuthorIdentity));
      }
      if (statusChanged) {
        generatedHistoryEntries.push(
          lifecycleChangeEntry(
            working,
            lastSavedStatusRef.current,
            savingAuthorIdentity ?? { name: "Department author", position: "Department Author" },
          ),
        );
      }
      const toSave: Sop = generatedHistoryEntries.length
        ? { ...working, changeHistory: appendMissingChangeEntries(working.changeHistory, generatedHistoryEntries) }
        : working;
      try {
        const next = await saveSop(toSave, workspaceId!, saveOptions);
        persistedAnnexIdsRef.current = new Set(next.annexes.flatMap((annex) => (annex.id ? [annex.id] : [])));
        // Advance the ref synchronously so a click awaiting this save reads the fresh token.
        persistedUpdatedAtRef.current = next.updatedAt;
        setPersistedUpdatedAt(next.updatedAt);
        lastSavedStatusRef.current = next.status;
        if (editVersionRef.current === sopEditVersion) {
          // Nothing changed since the render that produced `sop` -- adopt the server copy wholesale.
          setSop(next);
          setDirty(false);
          setSaveStatus("saved");
        } else {
          // Edits landed after that render: keep them (still dirty, so autosave picks them up)
          // and only fold in the server timestamp plus the auto-appended history row.
          setSop((current) => ({
            ...current,
            updatedAt: next.updatedAt,
            changeHistory: appendMissingChangeEntries(current.changeHistory, generatedHistoryEntries),
          }));
          setSaveStatus("idle");
        }
        return true;
      } catch (error) {
        if (error instanceof SopConflictError) {
          // Never retry into a conflict -- the user copies their changes and reloads.
          setConflicted(true);
        }
        setSaveError(error instanceof Error ? error.message : "Save failed.");
        setSaveStatus("error");
        return false;
      }
    } finally {
      saveInFlightRef.current = false;
    }
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
      const next = withAnnexIds(latest.sop);
      persistedAnnexIdsRef.current = new Set(next.annexes.flatMap((annex) => (annex.id ? [annex.id] : [])));
      editVersionRef.current += 1;
      lastSavedStatusRef.current = next.status;
      setSop(next);
      persistedUpdatedAtRef.current = next.updatedAt;
      setPersistedUpdatedAt(next.updatedAt);
      setDirty(false);
      setConflicted(false);
      setSaveError("");
      setSaveStatus("saved");
      setAnnexUploadStatus(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not reload the latest SOP.");
      setSaveStatus("error");
    } finally {
      setReloadingLatest(false);
    }
  }

  function handleLoadSample() {
    setSop((current) => {
      const sample = withAnnexIds(applySampleData(current));
      // Sample content must never replace an existing controlled identity. New SOPs keep an
      // empty stored number until the first save mints the real department sequence.
      return { ...sample, meta: { ...sample.meta, sopNumber: current.meta.sopNumber } };
    });
    editVersionRef.current += 1;
    setDirty(true);
    setSaveStatus("idle");
  }

  async function handleAnnexUpload(index: number, file: File) {
    const annex = sop.annexes[index];
    if (!annex?.id || !workspaceId) {
      setAnnexFileError("Save this SOP before uploading a form.");
      return;
    }
    const requiresSopSave = !persistedAnnexIdsRef.current.has(annex.id);
    setUploadingAnnexId(annex.id);
    setAnnexFileError("");
    setAnnexUploadStatus({
      annexId: annex.id,
      phase: requiresSopSave ? "saving" : "uploading",
      message: requiresSopSave ? "Saving this new form row before upload…" : `Uploading ${file.name}…`,
    });
    try {
      if (requiresSopSave && !(await persist())) {
        setAnnexUploadStatus({
          annexId: annex.id,
          phase: "error",
          message: "Upload paused because the SOP could not be saved. Resolve the save warning above, then try again.",
        });
        return;
      }
      setAnnexUploadStatus({ annexId: annex.id, phase: "uploading", message: `Uploading ${file.name}…` });
      const saved = await uploadSopAnnexFile({ workspaceId, sopId: sop.id, annexId: annex.id, file });
      setAnnexFiles((current) => [...current.filter((item) => item.annexId !== annex.id), saved]);
      setAnnexUploadStatus({
        annexId: annex.id,
        phase: "success",
        message: "Upload complete.",
      });
    } catch (error) {
      setAnnexUploadStatus({
        annexId: annex.id,
        phase: "error",
        message: error instanceof Error ? error.message : "Could not upload the form.",
      });
    } finally {
      setUploadingAnnexId(null);
    }
  }

  async function handleAnnexOpen(file: SopAnnexFile) {
    setAnnexFileError("");
    try {
      await openSopAnnexFile(file);
    } catch (error) {
      setAnnexFileError(error instanceof Error ? error.message : "Could not open the form.");
    }
  }

  async function handleAnnexFileRemove(file: SopAnnexFile) {
    setAnnexFileError("");
    try {
      await removeSopAnnexFile(file);
      setAnnexFiles((current) => current.filter((item) => item.id !== file.id));
    } catch (error) {
      setAnnexFileError(error instanceof Error ? error.message : "Could not remove the form.");
    }
  }

  async function handleReferenceDocUpload(file: File) {
    if (!workspaceId) {
      setReferenceDocError("Select an organization before uploading.");
      return;
    }
    setReferenceDocError("");
    setUploadingReferenceDoc(true);
    try {
      // The file row's sop_id FK needs the SOP to exist server-side; persist() closes over
      // this render's document, so it runs BEFORE the new reference row is added to state.
      if (!hasPersistedSop && !(await persist())) {
        setReferenceDocError(
          "Upload paused because the SOP could not be saved. Resolve the save warning above, then try again.",
        );
        return;
      }
      const docId = newReferenceDocId();
      const saved = await uploadSopAnnexFile({ workspaceId, sopId: sop.id, annexId: docId, file });
      setAnnexFiles((current) => [...current.filter((item) => item.annexId !== docId), saved]);
      // Added after the upload succeeds; autosave persists the document row.
      update((current) => ({
        referenceDocs: [...current.referenceDocs, { id: docId, name: file.name }],
      }));
    } catch (error) {
      setReferenceDocError(error instanceof Error ? error.message : "Could not upload the document.");
    } finally {
      setUploadingReferenceDoc(false);
    }
  }

  async function handleReferenceDocOpen(doc: SopReferenceDoc) {
    const file = referenceFileByDocId.get(doc.id);
    if (!file) {
      setReferenceDocError("This document's file is missing. Remove the row and upload it again.");
      return;
    }
    setReferenceDocError("");
    try {
      await openSopAnnexFile(file);
    } catch (error) {
      setReferenceDocError(error instanceof Error ? error.message : "Could not open the document.");
    }
  }

  async function handleReferenceDocRemove(doc: SopReferenceDoc) {
    setReferenceDocError("");
    const file = referenceFileByDocId.get(doc.id);
    try {
      if (file) {
        await removeSopAnnexFile(file);
        setAnnexFiles((current) => current.filter((item) => item.id !== file.id));
      }
      update((current) => ({
        referenceDocs: current.referenceDocs.filter((item) => item.id !== doc.id),
      }));
    } catch (error) {
      setReferenceDocError(error instanceof Error ? error.message : "Could not remove the document.");
    }
  }

  async function handleAnnexRowRemove(index: number) {
    const annex = sop.annexes[index];
    const file = annex?.id ? annexFiles.find((item) => item.annexId === annex.id) : undefined;
    if (file) {
      try {
        await removeSopAnnexFile(file);
        setAnnexFiles((current) => current.filter((item) => item.id !== file.id));
      } catch (error) {
        setAnnexFileError(error instanceof Error ? error.message : "Could not remove the attached form.");
        return;
      }
    }
    update({ annexes: sop.annexes.filter((_, rowIndex) => rowIndex !== index) });
  }

  // Warn on tab close / hard navigation while there are unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty]);

  // Debounced autosave after the latest edit settles. New SOPs use the same path for their
  // initial INSERT and number assignment; simply opening the builder never creates an empty
  // draft. A failed save waits for a retry or the next edit, and conflicts stop autosave.
  const autosaveArmed =
    canEdit && Boolean(workspaceId) && dirty && !conflicted && Boolean(selectedDept) && saveStatus === "idle";
  useEffect(() => {
    if (!autosaveArmed) return;
    const timer = window.setTimeout(() => {
      void persist();
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
    // `persist` is recreated per render with the latest sop; re-arming on `sop` restarts
    // the debounce after every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosaveArmed, sop, deptId]);

  useEffect(() => {
    if (!workspaceId || !persistedUpdatedAt) {
      setAnnexFiles([]);
      return;
    }
    let active = true;
    listSopAnnexFiles(sop.id)
      .then((files) => {
        if (active) setAnnexFiles(files);
      })
      .catch((error: unknown) => {
        if (active) setAnnexFileError(error instanceof Error ? error.message : "Could not load attached forms.");
      });
    return () => {
      active = false;
    };
  }, [persistedUpdatedAt, sop.id, workspaceId]);

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
    if (nextStep?.id === "approvals" && !hasPersistedSop && !(await persist())) return;
    setStepIndex(index);
  }

  function openRemarkSection(category: string) {
    const target = REVIEW_CATEGORY_STEPS[category] ?? "document";
    const targetIndex = steps.findIndex((item) => item.id === target);
    if (targetIndex >= 0) void handleStepSelect(targetIndex);
  }

  async function handleRecallForChanges() {
    if (recallingReview || !reviewGate.canMakeChanges) return;
    setRecallingReview(true);
    setSaveError("");
    try {
      const latest = await getSopControl(sop.id);
      if (!latest) throw new Error("The SOP could not be loaded before recalling it.");
      if (latest.status !== "in_review") {
        router.replace(`/sops/${sop.id}?step=draft-review`);
        return;
      }
      await transitionSop(sop.id, "draft", latest.updatedAt);
      router.replace(`/sops/${sop.id}?step=draft-review`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The SOP could not be recalled for changes.");
      setSaveStatus("error");
      setRecallingReview(false);
    }
  }

  async function handleMarkRemarkAddressed(annotationId: string) {
    if (resolvingAnnotationId) return;
    setResolvingAnnotationId(annotationId);
    setSaveError("");
    try {
      await resolveSopReviewAnnotation(annotationId);
      setReviewAnnotations((current) => current.filter((item) => item.id !== annotationId));
      setAuditEvents(await listSopAuditEvents(sop.id));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The remark could not be marked addressed.");
      setSaveStatus("error");
    } finally {
      setResolvingAnnotationId(null);
    }
  }

  async function handleRequestFinalApproval() {
    if (requestingFinalApproval || finalApprovalRequested) return;
    setRequestingFinalApproval(true);
    setSaveError("");
    try {
      await requestSopFinalApproval(sop.id);
      await refreshApprovalRouting();
      setAuditEvents(await listSopAuditEvents(sop.id));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The SOP could not be sent for final approval.");
      setSaveStatus("error");
    } finally {
      setRequestingFinalApproval(false);
    }
  }

  // Submission is one action from the editor: save the current draft, bind the author's
  // declaration to that exact content, then let the database validate the department roster
  // and move the SOP into draft review. Assigned seat holders see it in their review queue.
  async function handleStartApproval() {
    if (submittingForApproval) return;
    // Single review round: after every reviewer has responded, resubmitting
    // routes to final approval — the remarks must be addressed first.
    if (reviewGate.allResponded && reviewAnnotations.length > 0) {
      setSaveError("Mark every returned remark as addressed before sending for signatures.");
      setSaveStatus("error");
      return;
    }
    setSubmittingForApproval(true);
    setSaveError("");
    try {
      if (!(await persist())) return;

      const control = await getSopControl(sop.id);
      if (!control) throw new Error("The saved SOP could not be loaded for submission.");
      if (control.status !== "draft") {
        setSop((current) => ({ ...current, status: control.status, updatedAt: control.updatedAt }));
        persistedUpdatedAtRef.current = control.updatedAt;
        setPersistedUpdatedAt(control.updatedAt);
        lastSavedStatusRef.current = control.status;
        setStepIndex(CREATOR_STEPS.length);
        window.history.replaceState(
          window.history.state,
          "",
          `/sops/${encodeURIComponent(sop.id)}?step=draft-review`,
        );
        return;
      }

      const supabase = createPlannerSupabaseClient();
      const userResult = await getUserFromSession(supabase);
      const userId = userResult.data.user?.id;
      if (!userId) throw new Error("Your session expired. Sign in again before submitting this SOP.");

      const signatures = await listSignatures(sop.id);
      const hasCurrentAuthorship = signatures.some(
        (signature) =>
          signature.meaning === "authorship" &&
          signature.signerId === userId &&
          isSignatureCurrent(signature, control),
      );
      if (!hasCurrentAuthorship) await signSop(sop.id, "authorship");

      const latest = await getSopControl(sop.id);
      if (!latest) throw new Error("The SOP could not be reloaded after signing.");
      const transitioned = await transitionSop(sop.id, "in_review", latest.updatedAt);
      setSop((current) => ({ ...current, status: transitioned.status, updatedAt: transitioned.updatedAt }));
      persistedUpdatedAtRef.current = transitioned.updatedAt;
      setPersistedUpdatedAt(transitioned.updatedAt);
      lastSavedStatusRef.current = transitioned.status;
      // The review round already happened — go straight to the signature phase
      // instead of reopening the reviewers' queue.
      if (reviewGate.allResponded) await requestSopFinalApproval(sop.id);
      await refreshApprovalRouting({ background: true });
      setAuditEvents(await listSopAuditEvents(sop.id));

      const nextWorkflowStep = reviewGate.allResponded ? "final-approval" : "draft-review";
      setStepIndex(CREATOR_STEPS.length + (reviewGate.allResponded ? 1 : 0));
      window.history.replaceState(
        window.history.state,
        "",
        `/sops/${encodeURIComponent(sop.id)}?step=${nextWorkflowStep}`,
      );
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The SOP could not be sent for review.");
      setSaveStatus("error");
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
      const blob = await exportSopToDocx(renderedSop);
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

  const actions = (
    <>
      {canEdit ? (
        <button
          type="button"
          className="ui-btn-ghost h-9 w-9 px-0"
          onClick={handleLoadSample}
          title="Fill every step with sample data"
          aria-label="Fill with sample data"
        >
          <Sparkles size={15} />
        </button>
      ) : null}
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

  const sidebar = (
    <>
      <div className="ui-nav-section">SOP Builder</div>
      <div className="space-y-0.5">
        {steps.map((entry, index) => {
          const active = index === stepIndex;
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
          const stepButton = (
            <button
              type="button"
              className={`ui-nav-item w-full ${active ? "ui-nav-item-active" : "ui-nav-item-idle"}`}
              onClick={() => void handleStepSelect(index)}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {active ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                ) : filled ? (
                  <Check size={13} style={{ color: "var(--color-success)" }} />
                ) : (
                  <span className="ui-mono-label text-ink-tertiary">{index + 1}</span>
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-left">{entry.label}</span>
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
        annexFiles={annexFiles}
        onClose={closePreview}
        backLink={previewBackLink}
      />
    );
  }

  if (requestedStepId && requestedStepIndex < 0) {
    return <SopDetailLoadingState initialView={initialView} />;
  }

  return (
    <SopShell
      crumb={sop.meta.title || sop.meta.sopNumber || "Untitled"}
      actions={actions}
      sidebar={sidebar}
      back={{ href: "/sops", label: "All SOPs" }}
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
        <div className={`mx-auto max-w-4xl ${step.id === "document" ? "" : "pb-16"}`}>
          <div className="min-w-0 space-y-5">

            {showConvertedReview && !reviewDismissed ? (
              <div
                role="status"
                aria-live="polite"
                className={`ui-notice ui-notice-warn fixed right-4 top-16 z-[55] flex w-[min(24rem,calc(100vw-2rem))] items-start gap-2 px-3 py-2 transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none ${
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

            {showDraftReview && step.id !== "draftReview" && stepReviewAnnotations.length ? (
              <section className="ui-panel overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                  <div className="flex items-center gap-2">
                    <MessageSquare size={14} className="text-amber-700" />
                    <div>
                      <h2 className="ui-setup-section-title">Review feedback for {step.label}</h2>
                      <p className="mt-0.5 text-xs text-ink-tertiary">
                        Update this section using the reviewer remarks below.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ui-btn-ghost h-8 px-3"
                    onClick={() => void handleStepSelect(steps.findIndex((item) => item.id === "draftReview"))}
                  >
                    View all feedback
                  </button>
                </div>
                <div className="divide-y divide-line">
                  {stepReviewAnnotations.map((annotation) => (
                    <div key={annotation.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                      <span className="ui-chip mt-0.5 shrink-0">
                        {REVIEW_CATEGORY_LABELS[annotation.category] ?? "Overall remarks"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-5 text-ink">{annotation.body}</p>
                        <p className="mt-1 text-[11px] text-ink-tertiary">Requested by {annotation.authorName}</p>
                      </div>
                      {sop.status === "draft" && canEdit ? (
                        <button
                          type="button"
                          className="ui-btn-ghost h-8 shrink-0 gap-1.5 px-3 text-emerald-700 disabled:opacity-50"
                          onClick={() => void handleMarkRemarkAddressed(annotation.id)}
                          disabled={Boolean(resolvingAnnotationId)}
                        >
                          {resolvingAnnotationId === annotation.id
                            ? <Loader2 size={13} className="animate-spin" />
                            : <CircleCheck size={13} />}
                          Addressed
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {step.id === "document" ? (
              <div className="flex min-h-[calc(100dvh-8rem)] py-8">
                <section
                  className="flex w-full flex-col px-2 py-4 sm:px-5 sm:py-8"
                  data-review-attention={
                    reviewCategoriesNeedingAttention.has("document") ||
                    reviewCategoriesNeedingAttention.has("overall")
                      ? "true"
                      : undefined
                  }
                >
                  <h2 className="border-b border-line pb-4 text-lg font-semibold leading-7 text-ink">Document</h2>
                  <div className="mt-8 grid gap-x-12 gap-y-9 sm:grid-cols-2">
                    {authMode && authMode.kind !== "blocked" ? (
                      <DocumentField label="Owning department" className="sm:col-span-2">
                        {authMode.kind === "choose" && !persistedUpdatedAt ? (
                          <div
                            className={canEdit ? "sop-document-select-shell" : "border-b border-line"}
                          >
                            <ThemedSelect
                              variant="sop"
                              ariaLabel="Owning department"
                              value={deptId}
                              disabled={!canEdit}
                              triggerClassName="ui-sop-select-inline"
                              options={authMode.departments.map((department) => ({
                                value: department.id,
                                label: `${department.code} · ${department.name}`,
                              }))}
                              onChange={setDeptId}
                            />
                          </div>
                        ) : (
                          <div className="sop-document-field flex items-center" aria-readonly="true">
                            <span className="truncate">{selectedDept?.name ?? "—"}</span>
                          </div>
                        )}
                      </DocumentField>
                    ) : null}

                    <DocumentField label="SOP number">
                      <div className="sop-document-field flex items-center" aria-readonly="true">
                        <span className="truncate">
                          {isNew && !persistedUpdatedAt && !selectedDept ? "Assigned on save" : displaySopNumber}
                        </span>
                      </div>
                    </DocumentField>

                    <DocumentField label="Title">
                      <input
                        className={`ui-field-standalone sop-document-field ${canEdit ? "sop-document-input" : ""}`}
                        value={sop.meta.title}
                        placeholder="QMS"
                        disabled={!canEdit}
                        onChange={(event) => update({ meta: { ...sop.meta, title: event.target.value } })}
                      />
                    </DocumentField>

                    <DocumentField label="Version">
                      <div className="sop-document-field flex items-center" aria-readonly="true">
                        <span className="truncate">{controlledVersion}</span>
                      </div>
                    </DocumentField>

                    <DocumentField label="Status">
                      <div className="flex h-11 items-center">
                        <span
                          className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${
                            sop.status === "approved"
                              ? "bg-accent-subtle text-accent"
                              : sop.status === "obsolete"
                                ? "bg-danger-muted text-danger"
                                : "bg-surface-muted text-ink-secondary"
                          }`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />
                          {SOP_STATUS_LABELS[sop.status]}
                        </span>
                      </div>
                    </DocumentField>

                    {approvalReviewCycle > 0 ? (
                      <DocumentField label="Revision date">
                        <input
                          type="date"
                          required
                          className={`ui-field-standalone sop-document-field ${canEdit ? "sop-document-input" : ""}`}
                          value={sop.meta.revisionDate}
                          disabled={!canEdit}
                          onChange={(event) => update({ meta: { ...sop.meta, revisionDate: event.target.value } })}
                        />
                      </DocumentField>
                    ) : null}
                  </div>

                  <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
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
                      className="ui-btn-ghost h-9 gap-1.5 px-4"
                      onClick={() => void handleStepSelect(Math.min(steps.length - 1, stepIndex + 1))}
                    >
                      Next
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </section>
              </div>
            ) : null}

            {step.id === "overview" ? (
              <>
                <Section title="Purpose" reviewAttention={reviewCategoriesNeedingAttention.has("purpose")}>
                  <AutoTextarea
                    className="ui-field-standalone min-h-20 py-2"
                    value={sop.purpose}
                    placeholder="Define the purpose of this process"
                    disabled={!canEdit}
                    onChange={(event) => update({ purpose: event.target.value })}
                  />
                </Section>
                <Section title="Scope" reviewAttention={reviewCategoriesNeedingAttention.has("scope")}>
                  <AutoTextarea
                    className="ui-field-standalone min-h-20 py-2"
                    value={sop.scope}
                    placeholder="For which products, processes or areas this applies"
                    disabled={!canEdit}
                    onChange={(event) => update({ scope: event.target.value })}
                  />
                </Section>
                <Section title="Definitions" reviewAttention={reviewCategoriesNeedingAttention.has("definitions")}>
                  <PairListEditor
                    rows={sop.definitions}
                    keyLabel="Term"
                    valueLabel="Definition"
                    keyName="term"
                    valueName="definition"
                    disabled={!canEdit}
                    onChange={(definitions) => update({ definitions })}
                  />
                </Section>
                <Section title="References" reviewAttention={reviewCategoriesNeedingAttention.has("references")}>
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
                    onUpload={(file) => void handleReferenceDocUpload(file)}
                    onOpenDoc={(doc) => void handleReferenceDocOpen(doc)}
                    onRemoveDoc={(doc) => void handleReferenceDocRemove(doc)}
                  />
                </Section>
              </>
            ) : null}

            {step.id === "procedure" ? (
              <>
                <Section
                  title="Responsible person(s)"
                  reviewAttention={reviewCategoriesNeedingAttention.has("responsible")}
                >
                  <input
                    type="text"
                    className="ui-field-standalone"
                    aria-label="Responsible person or role"
                    placeholder="e.g. Quality Manager"
                    value={sop.responsiblePersons.join("; ")}
                    disabled={!canEdit}
                    onChange={(event) => {
                      const value = event.target.value;
                      update({ responsiblePersons: value ? [value] : [] });
                    }}
                  />
                </Section>
                <Section
                  title="Measurement (KPIs)"
                  reviewAttention={reviewCategoriesNeedingAttention.has("measurements")}
                >
                  <StringListEditor
                    items={sop.measurements}
                    placeholder="e.g. % of released SOPs"
                    disabled={!canEdit}
                    onChange={(measurements) => update({ measurements })}
                  />
                </Section>
                <Section title="Procedure" reviewAttention={reviewCategoriesNeedingAttention.has("procedure")}>
                  <Field label="Process flow description">
                    <AutoTextarea
                      className="ui-field-standalone min-h-16 py-2"
                      value={sop.procedure.processFlowDescription}
                      placeholder="Describe the process flow"
                      disabled={!canEdit}
                      onChange={(event) =>
                        update({ procedure: { ...sop.procedure, processFlowDescription: event.target.value } })
                      }
                    />
                  </Field>
                  <p className="ui-mono-label mt-3 text-ink-tertiary">
                    RASIC — {rasicLegend()}
                  </p>
                  <ProcessFlowchart
                    roles={sop.procedure.roles}
                    activities={sop.procedure.activities}
                    departments={approvalDepartments}
                    disabled={!canEdit}
                    onChange={(roles, activities) => update({ procedure: { ...sop.procedure, roles, activities } })}
                  />
                </Section>
              </>
            ) : null}

            {step.id === "annexes" ? (
              <>
                <Section title="Annexes & forms" reviewAttention={reviewCategoriesNeedingAttention.has("annexes")}>
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
                    onRemoveFile={(file) => void handleAnnexFileRemove(file)}
                    onRemoveRow={(index) => void handleAnnexRowRemove(index)}
                  />
                  {annexFileError ? <p className="mt-2 text-xs text-danger">{annexFileError}</p> : null}
                </Section>
                <Section title="Change history" reviewAttention={reviewCategoriesNeedingAttention.has("history")}>
                  <ChangeHistoryEditor
                    rows={sop.changeHistory}
                    disabled={!canEdit}
                    onChange={(changeHistory) => update({ changeHistory })}
                  />
                </Section>
              </>
            ) : null}

            {step.id === "approvals" ? (
              <>
                {approvalRoutingError ? (
                  <div className="ui-notice ui-notice-warn px-4 py-3 text-xs">{approvalRoutingError}</div>
                ) : null}
                {approvalRoutingLoading ? (
                  <section className="ui-panel flex min-h-32 items-center justify-center">
                    <Loader2 size={18} className="animate-spin text-ink-tertiary" />
                  </section>
                ) : hasPersistedSop && canEdit ? (
                  <SopRosterEditor
                    sopId={sop.id}
                    departments={approvalDepartments}
                    seats={approvalSeats}
                    onChanged={() => refreshApprovalRouting({ background: true })}
                  />
                ) : (
                  <section className="ui-panel overflow-hidden">
                    <div className="border-b border-line px-4 py-3 ui-mono-label text-ink-tertiary">
                      Approval routing
                    </div>
                    <div className="divide-y divide-line">
                      {approvalSeats.length ? approvalSeats.map((seat) => {
                        const department = approvalDepartments.find((item) => item.id === seat.departmentId);
                        return (
                          <div key={seat.departmentId} className="flex items-center gap-3 px-4 py-3 text-sm">
                            <span className="ui-chip">{department?.code ?? "—"}</span>
                            <span className="min-w-0 flex-1 truncate">{department?.name ?? "Unknown department"}</span>
                            <span className="ui-mono-label text-ink-tertiary">Required approval</span>
                          </div>
                        );
                      }) : (
                        <p className="px-4 py-8 text-center text-xs text-ink-tertiary">
                          Save the draft to configure department routing.
                        </p>
                      )}
                    </div>
                  </section>
                )}
              </>
            ) : null}

            {step.id === "draftReview" ? (
              <div className="space-y-5">
                <section className="ui-panel overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <MessageSquare size={14} className="text-ink-secondary" />
                        <h2 className="ui-setup-section-title">Draft review</h2>
                      </div>
                      <p className="mt-1 text-xs text-ink-tertiary">
                        {sop.status === "in_review"
                          ? "Track each reviewer and read the remarks returned on this draft."
                          : "Work through the returned remarks, then send the updated draft for a new review."}
                      </p>
                    </div>
                    {sop.status === "in_review" && draftReviewers.length && !finalApprovalRequested ? (
                      <button
                        type="button"
                        className="ui-btn-primary h-9 gap-2 px-4 disabled:opacity-50"
                        onClick={() => void handleRecallForChanges()}
                        disabled={recallingReview || !reviewGate.canMakeChanges}
                        title={
                          reviewGate.reason === "waiting"
                            ? "Available once every reviewer has responded."
                            : reviewGate.reason === "approved"
                              ? "Every reviewer returned no changes needed — send for final approval instead."
                              : "Recall the draft to address the returned feedback."
                        }
                      >
                        {recallingReview ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                        {recallingReview ? "Recalling…" : "Make changes"}
                      </button>
                    ) : null}
                  </div>
                  <div className="divide-y divide-line">
                    {draftReviewers.length ? draftReviewers.map((reviewer) => {
                      const status = !reviewer.submission
                        ? "Reviewing"
                        : reviewer.submission.noChanges
                          ? "No changes needed"
                          : "Changes requested";
                      const statusClass = !reviewer.submission
                        ? "bg-zinc-400"
                        : reviewer.submission.noChanges
                          ? "bg-emerald-600"
                          : "bg-red-600";
                      return (
                        <div key={reviewer.userId} className="flex items-center gap-3 px-4 py-3">
                          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusClass}`} aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-ink">{reviewer.name}</p>
                            <p className="mt-0.5 text-xs text-ink-tertiary">{status}</p>
                          </div>
                          {reviewer.submission ? (
                            <span className="shrink-0 text-xs tabular-nums text-ink-tertiary">
                              {formatReviewDate(reviewer.submission.submittedAt)}
                            </span>
                          ) : null}
                        </div>
                      );
                    }) : (
                      <p className="px-4 py-8 text-center text-xs text-ink-tertiary">
                        Reviewer assignments are still being prepared.
                      </p>
                    )}
                  </div>
                </section>

                {finalApprovalReady || finalApprovalRequested ? (
                  <section className="ui-panel overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
                      <div className="flex min-w-0 items-start gap-3">
                        <ShieldCheck size={17} className="mt-0.5 shrink-0 text-emerald-700" />
                        <div>
                          <h2 className="ui-setup-section-title">
                            {finalApprovalRequested ? "Final approval requested" : "Draft review complete"}
                          </h2>
                          <p className="mt-1 text-xs leading-5 text-ink-tertiary">
                            {finalApprovalRequested
                              ? "The required approvers can now find this SOP under Final approval in their Review Queue."
                              : reviewGate.changesRequested
                                ? "Every reviewer has responded and the returned remarks are addressed. Send the current document to its formal approvers."
                                : "Every reviewer returned No changes needed. Send the current document to its formal approvers."}
                          </p>
                        </div>
                      </div>
                      {finalApprovalRequested ? (
                        <span className="ui-chip shrink-0 border-emerald-600 text-emerald-700">Sent</span>
                      ) : (
                        <button
                          type="button"
                          className="ui-btn-primary h-9 shrink-0 gap-2 px-4 disabled:opacity-50"
                          onClick={() => void handleRequestFinalApproval()}
                          disabled={requestingFinalApproval}
                        >
                          {requestingFinalApproval
                            ? <Loader2 size={14} className="animate-spin" />
                            : <ShieldCheck size={14} />}
                          {requestingFinalApproval ? "Sending…" : "Send for final approval"}
                        </button>
                      )}
                    </div>
                  </section>
                ) : null}

                <section className="ui-panel overflow-hidden">
                  <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                    <h2 className="ui-setup-section-title">Returned remarks</h2>
                    {reviewAnnotations.length ? (
                      <span className="ui-chip">{reviewAnnotations.length}</span>
                    ) : null}
                  </div>
                  {reviewAnnotations.length ? (
                    <div className="divide-y divide-line">
                      {reviewAnnotations.map((annotation) => (
                        <div key={annotation.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[10rem_1fr_auto] sm:items-center">
                          <span className="ui-chip w-fit">
                            {REVIEW_CATEGORY_LABELS[annotation.category] ?? "Overall remarks"}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs leading-5 text-ink">{annotation.body}</p>
                            <p className="mt-1 text-[11px] text-ink-tertiary">{annotation.authorName}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                            <button
                              type="button"
                              className="ui-btn-ghost h-8 px-3"
                              onClick={() => openRemarkSection(annotation.category)}
                            >
                              Open section
                            </button>
                            {sop.status === "draft" && canEdit ? (
                              <button
                                type="button"
                                className="ui-btn-ghost h-8 gap-1.5 px-3 text-emerald-700 disabled:opacity-50"
                                onClick={() => void handleMarkRemarkAddressed(annotation.id)}
                                disabled={Boolean(resolvingAnnotationId)}
                              >
                                {resolvingAnnotationId === annotation.id
                                  ? <Loader2 size={13} className="animate-spin" />
                                  : <CircleCheck size={13} />}
                                Addressed
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-8 text-center">
                      <p className="text-sm font-medium text-ink">No remarks returned</p>
                      <p className="mt-1 text-xs text-ink-tertiary">
                        Reviewer progress will continue to update here while the SOP is in review.
                      </p>
                    </div>
                  )}
                </section>

              </div>
            ) : null}

            {step.id === "finalApproval" ? (
              <div className="space-y-5">
                <section className="ui-panel overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-4 py-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <ShieldCheck size={17} className="mt-0.5 shrink-0 text-emerald-700" />
                      <div>
                        <h2 className="ui-setup-section-title">Final approval</h2>
                        <p className="mt-1 text-xs leading-5 text-ink-tertiary">
                          Review the controlled document and track every required stakeholder signature before Quality release.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ui-btn-ghost h-9 gap-2 border border-line px-3"
                      onClick={() => setPreviewing(true)}
                    >
                      <FileText size={14} />
                      {finalApprovalRequested ? "Preview signed PDF" : "Preview document"}
                    </button>
                  </div>

                  {!finalApprovalRequested ? (
                    <div className="border-b border-line bg-surface-subtle px-4 py-3">
                      <p className="text-xs font-medium text-ink">Upcoming step</p>
                      <p className="mt-1 text-xs leading-5 text-ink-tertiary">
                        Final approval has not been requested yet. Complete Draft Review, then send the SOP to its formal approvers.
                      </p>
                    </div>
                  ) : null}

                  <div className="divide-y divide-line">
                    {finalApprovalStakeholders.map(({ seat, department, name, signature }) => (
                      <div key={seat.departmentId} className="flex items-center gap-3 px-4 py-3">
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${signature ? "bg-emerald-600" : "bg-zinc-400"}`}
                          aria-hidden
                        />
                        <span className="ui-chip shrink-0">{department?.code ?? "—"}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">{name}</p>
                          <p className="mt-0.5 truncate text-xs text-ink-tertiary">
                            {department?.name ?? "Unknown department"} · Required approval
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={`text-xs font-medium ${signature ? "text-emerald-700" : "text-ink-tertiary"}`}>
                            {signature ? "Signed" : finalApprovalRequested ? "Waiting for signature" : "Not requested"}
                          </p>
                          {signature ? (
                            <p className="mt-0.5 text-[11px] tabular-nums text-ink-tertiary">
                              {formatReviewDate(signature.signedAt)}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

              </div>
            ) : null}

            {step.id === "qualityApproval" ? (
              <div className="space-y-5">
                <section className="ui-panel overflow-hidden">
                  <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-4">
                    <div className="flex min-w-0 items-start gap-3">
                      {sop.status === "effective" ? (
                        <CircleCheck size={17} className="mt-0.5 shrink-0 text-emerald-700" />
                      ) : (
                        <ShieldCheck size={17} className="mt-0.5 shrink-0 text-sky-700" />
                      )}
                      <div>
                        <h2 className="ui-setup-section-title">Quality approval</h2>
                        <p className="mt-1 text-xs leading-5 text-ink-tertiary">
                          {sop.status === "effective"
                            ? "Quality signed the controlled document and released it to the Effective Library."
                            : "Every stakeholder has signed. Quality must verify the controlled PDF, add the final signature, and release it."}
                        </p>
                      </div>
                    </div>
                    <span className={`ui-chip shrink-0 ${
                      sop.status === "effective"
                        ? "border-emerald-600 text-emerald-700"
                        : "border-sky-600 text-sky-700"
                    }`}>
                      {sop.status === "effective" ? "Effective" : "Awaiting Quality"}
                    </span>
                  </div>

                  {qualitySignature ? (
                    <div className="flex items-center gap-3 border-t border-line px-4 py-3">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-600" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">
                          {qualitySignature.signerName || "Quality approver"}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-tertiary">Quality final signature</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs font-medium text-emerald-700">Signed</p>
                        <p className="mt-0.5 text-[11px] tabular-nums text-ink-tertiary">
                          {formatReviewDate(qualitySignature.signedAt)}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </section>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    className="ui-btn-ghost h-9 gap-2 border border-line px-3"
                    onClick={() => setPreviewing(true)}
                  >
                    <FileText size={14} />
                    Preview signed PDF
                  </button>
                  {isCurrentUserQualityApprover && sop.status === "approved" ? (
                    <button
                      type="button"
                      className="ui-btn-primary h-9 gap-2 px-4"
                      onClick={() => setQualityApprovalOpen(true)}
                    >
                      <ShieldCheck size={14} />
                      Review, sign & release
                    </button>
                  ) : null}
                </div>
              </div>
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
                        disabled={saveDisabled || submittingForApproval || approvalRoutingLoading || !approvalRoutingReady}
                        title={
                          approvalRoutingReady
                            ? reviewGate.allResponded
                              ? "The review round is complete — save this draft and send it to the formal approvers for signature"
                              : "Save this draft and send it to every required departmental approver"
                            : "Assign at least one required departmental approver who is not the SOP author"
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
                  className="ui-btn-ghost h-9 gap-1.5 px-4"
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
                          {formatReviewDate(event.createdAt)}
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
          <SopPrintPreview sop={renderedSop} annexFiles={annexFiles} onClose={closePreview} />
        ) : null}
        {qualityApprovalOpen ? (
          <SopQualityApprovalWorkspace
            sopId={sop.id}
            onClose={() => setQualityApprovalOpen(false)}
            onReleased={() => void refreshApprovalRouting({ background: true })}
            returnLabel="Back to Quality Approval"
          />
        ) : null}
      </SopShell>
  );
}
// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
  reviewAttention = false,
}: {
  title: string;
  children: ReactNode;
  reviewAttention?: boolean;
}) {
  return (
    <section
      className="border-b border-line bg-transparent px-5 py-4 transition-[border-color,background-color] duration-200"
      style={reviewAttention ? {
        borderColor: "var(--color-warn)",
        backgroundColor: "color-mix(in srgb, var(--color-warn) 5%, var(--color-canvas))",
      } : undefined}
      data-review-attention={reviewAttention ? "true" : undefined}
    >
      <h2 className="ui-setup-section-title mb-3">{title}</h2>
      {children}
    </section>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="ui-field-label">{label}</span>
      {children}
    </label>
  );
}
function DocumentField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="ui-setup-section-title mb-2 block">{label}</span>
      {children}
    </label>
  );
}
function RowDeleteButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      className="ui-btn-ghost h-9 w-9 shrink-0 px-0 text-ink-tertiary hover:text-danger"
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <Trash2 size={13} />
    </button>
  );
}
function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="ui-btn-ghost mt-2 h-8 gap-1.5 px-3" onClick={onClick}>
      <Plus size={13} />
      {label}
    </button>
  );
}
// ---------------------------------------------------------------------------
// List editors
// ---------------------------------------------------------------------------

function ReferenceLibraryEditor({
  references,
  links,
  docs,
  files,
  options,
  loading,
  error,
  disabled = false,
  uploading = false,
  onChangeReferences,
  onChangeLinks,
  onUpload,
  onOpenDoc,
  onRemoveDoc,
}: {
  references: string[];
  links: SopLinkedSop[];
  docs: SopReferenceDoc[];
  /** Reference-doc id -> uploaded file (for open/remove and the "missing file" state). */
  files: Map<string, SopAnnexFile>;
  /** Workspace SOPs offered by the picker (the current SOP already excluded). */
  options: SopListItem[];
  loading: boolean;
  error: string;
  disabled?: boolean;
  uploading?: boolean;
  onChangeReferences: (references: string[]) => void;
  onChangeLinks: (links: SopLinkedSop[]) => void;
  onUpload: (file: File) => void;
  onOpenDoc: (doc: SopReferenceDoc) => void;
  onRemoveDoc: (doc: SopReferenceDoc) => void;
}) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<"sop" | "text">("sop");
  const [typedReference, setTypedReference] = useState("");
  const available = options.filter((option) => !links.some((link) => link.sopId === option.id));

  function addTypedReference() {
    const value = typedReference.trim();
    if (!value) return;
    onChangeReferences([...references, value]);
    setTypedReference("");
    setComposerOpen(false);
  }

  return (
    <div className="space-y-2">
      {references.map((reference, index) => (
        <div key={`reference-${index}`} className="flex min-h-9 items-center gap-2">
          <input
            className="ui-field-standalone min-w-0 flex-1"
            value={reference}
            placeholder="e.g. ISO 9001:2015"
            disabled={disabled}
            onChange={(event) => {
              const next = [...references];
              next[index] = event.target.value;
              onChangeReferences(next);
            }}
          />
          {disabled ? null : (
            <RowDeleteButton
              title="Remove reference"
              onClick={() => onChangeReferences(references.filter((_, rowIndex) => rowIndex !== index))}
            />
          )}
        </div>
      ))}

      {links.map((link) => (
        <div key={link.sopId} className="flex min-h-9 items-center gap-2">
          <span className="ui-chip shrink-0">{link.sopNumber || "SOP"}</span>
          <Link
            href={`/sops/${link.sopId}`}
            className="min-w-0 flex-1 truncate text-sm text-ink hover:underline"
            title={linkedSopLabel(link)}
          >
            {link.title || "Untitled SOP"}
          </Link>
          {disabled ? null : (
            <RowDeleteButton
              title="Remove SOP reference"
              onClick={() => onChangeLinks(links.filter((item) => item.sopId !== link.sopId))}
            />
          )}
        </div>
      ))}

      {docs.map((doc) => {
        const file = files.get(doc.id);
        return (
          <div key={doc.id} className="flex min-h-9 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center text-ink-tertiary">
              <Paperclip size={14} />
            </span>
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-sm text-ink hover:underline"
              title={file ? `Open ${doc.name}` : `${doc.name} (file missing)`}
              onClick={() => onOpenDoc(doc)}
            >
              {doc.name}
              {file ? (
                <span className="ml-2 text-[11px] text-ink-tertiary">{formatFileSize(file.sizeBytes)}</span>
              ) : (
                <span className="ml-2 text-[11px] text-danger">file missing</span>
              )}
            </button>
            {disabled ? null : (
              <RowDeleteButton title="Remove document reference" onClick={() => onRemoveDoc(doc)} />
            )}
          </div>
        );
      })}

      {error ? <p className="text-xs text-danger">{error}</p> : null}

      {disabled ? null : (
        composerOpen ? (
          <div className="mt-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                {composerMode === "sop" ? (
                  loading ? (
                    <div className="flex min-h-9 items-center gap-2 text-xs text-ink-tertiary">
                      <Loader2 size={13} className="animate-spin" /> Loading effective SOPs…
                    </div>
                  ) : available.length ? (
                    <ThemedSelect
                      className="w-full"
                      ariaLabel="Select an effective SOP"
                      value=""
                      placeholder="Select effective SOP…"
                      options={available.map((option) => ({
                        value: option.id,
                        label: `${option.sopNumber || "—"} · ${option.title || "Untitled SOP"}`,
                      }))}
                      onChange={(sopId) => {
                        const target = available.find((option) => option.id === sopId);
                        if (!target) return;
                        onChangeLinks([
                          ...links,
                          { sopId: target.id, sopNumber: target.sopNumber, title: target.title },
                        ]);
                        setComposerOpen(false);
                      }}
                    />
                  ) : (
                    <div className="flex min-h-9 items-center rounded-md border border-line px-3 text-xs text-ink-tertiary">
                      {options.length
                        ? "Every effective SOP is already referenced."
                        : "No effective SOPs are available yet."}
                    </div>
                  )
                ) : (
                  <div className="flex gap-2">
                    <input
                      id="typed-sop-reference"
                      className="ui-field-standalone min-w-0 flex-1"
                      aria-label="Typed reference"
                      value={typedReference}
                      placeholder="e.g. ISO 9001:2015"
                      onChange={(event) => setTypedReference(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        addTypedReference();
                      }}
                    />
                    <button
                      type="button"
                      className="ui-btn-primary h-9 shrink-0 px-3 disabled:opacity-40"
                      disabled={!typedReference.trim()}
                      onClick={addTypedReference}
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {composerMode === "text" ? (
                  <label
                    className={`ui-btn-ghost inline-flex h-9 w-9 items-center justify-center px-0 ${
                      uploading ? "pointer-events-none cursor-wait opacity-60" : "cursor-pointer"
                    }`}
                    aria-disabled={uploading}
                    aria-label={uploading ? "Attaching reference document" : "Attach reference document"}
                    title={uploading ? "Attaching document…" : "Attach document"}
                  >
                    {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                    <span className="sr-only">{uploading ? "Attaching…" : "Attach document"}</span>
                    <input
                      type="file"
                      className="sr-only"
                      aria-label="Attach reference document"
                      accept={SOP_ANNEX_FILE_ACCEPT}
                      disabled={uploading}
                      onChange={(event) => {
                        const selected = event.target.files?.[0];
                        if (selected) onUpload(selected);
                        event.target.value = "";
                      }}
                    />
                  </label>
                ) : null}
                <button
                  type="button"
                  className="ui-btn-ghost h-9 w-9 shrink-0 px-0 text-ink-tertiary"
                  aria-label="Close reference options"
                  title="Close"
                  onClick={() => {
                    setComposerOpen(false);
                    setComposerMode("sop");
                    setTypedReference("");
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <ThemedSelect
            className="mt-2 w-44"
            triggerClassName="ui-themed-select-trigger-compact"
            ariaLabel="Add reference"
            value=""
            placeholder="+ Add reference"
            options={[
              { value: "sop", label: "Effective SOP" },
              { value: "text", label: "Typed reference" },
            ]}
            onChange={(mode) => {
              setComposerMode(mode === "text" ? "text" : "sop");
              setComposerOpen(true);
            }}
          />
        )
      )}
    </div>
  );
}

function StringListEditor({
  items,
  placeholder,
  disabled = false,
  onChange,
}: {
  items: string[];
  placeholder: string;
  disabled?: boolean;
  onChange: (items: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            className="ui-field-standalone min-w-0 flex-1"
            value={item}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(event) => {
              const next = [...items];
              next[index] = event.target.value;
              onChange(next);
            }}
          />
          {disabled ? null : (
            <RowDeleteButton title="Remove" onClick={() => onChange(items.filter((_, i) => i !== index))} />
          )}
        </div>
      ))}
      {disabled ? null : <AddButton label="Add" onClick={() => onChange([...items, ""])} />}
    </div>
  );
}

type PairRow<K extends string, V extends string> = Record<K | V, string>;

function PairListEditor<K extends string, V extends string>({
  rows,
  keyLabel,
  valueLabel,
  keyExample,
  valueExample,
  keyName,
  valueName,
  disabled = false,
  onChange,
}: {
  rows: Array<PairRow<K, V>>;
  keyLabel: string;
  valueLabel: string;
  keyExample?: string;
  valueExample?: string;
  keyName: K;
  valueName: V;
  disabled?: boolean;
  onChange: (rows: Array<PairRow<K, V>>) => void;
}) {
  function patch(index: number, field: K | V, value: string) {
    const next = rows.map((row, i) => (i === index ? { ...row, [field]: value } : row));
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-2">
          <input
            className="ui-field-standalone min-w-0"
            value={row[keyName]}
            placeholder={keyLabel}
            data-example={keyExample}
            disabled={disabled}
            onChange={(event) => patch(index, keyName, event.target.value)}
          />
          <input
            className="ui-field-standalone min-w-0"
            value={row[valueName]}
            placeholder={valueLabel}
            data-example={valueExample}
            disabled={disabled}
            onChange={(event) => patch(index, valueName, event.target.value)}
          />
          {disabled ? null : (
            <RowDeleteButton title="Remove" onClick={() => onChange(rows.filter((_, i) => i !== index))} />
          )}
        </div>
      ))}
      {disabled ? null : (
        <AddButton
          label="Add"
          onClick={() => onChange([...rows, { [keyName]: "", [valueName]: "" } as PairRow<K, V>])}
        />
      )}
    </div>
  );
}
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AnnexesEditor({
  sopId,
  rows,
  files,
  disabled = false,
  uploadingAnnexId,
  uploadStatus,
  onChange,
  onUpload,
  onOpen,
  onRemoveFile,
  onRemoveRow,
}: {
  sopId: string;
  rows: Sop["annexes"];
  files: SopAnnexFile[];
  disabled?: boolean;
  uploadingAnnexId: string | null;
  uploadStatus: AnnexUploadStatus | null;
  onChange: (changeRows: (current: Sop["annexes"]) => Sop["annexes"]) => void;
  onUpload: (index: number, file: File) => void | Promise<void>;
  onOpen: (file: SopAnnexFile) => void;
  onRemoveFile: (file: SopAnnexFile) => void;
  onRemoveRow: (index: number) => void;
}) {
  function patch(index: number, field: "label" | "description", value: string) {
    onChange((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)),
    );
  }

  return (
    <div>
      {rows.length ? (
        <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-2 px-1 pb-2 sm:grid">
          <span className="ui-field-label">Form name</span>
          <span className="ui-field-label">Description</span>
          <span className="w-9" aria-hidden="true" />
        </div>
      ) : null}
      <div className={rows.length ? "divide-y divide-line border-y border-line" : ""}>
        {rows.map((row, index) => {
          const file = files.find((item) => item.annexId === row.id);
          const uploading = uploadingAnnexId === row.id;
          const rowStatus = uploadStatus?.annexId === row.id ? uploadStatus : null;
          const uploadLabel = uploading
            ? rowStatus?.phase === "saving"
              ? "Saving attachment"
              : "Uploading attachment"
            : file
              ? "Replace attachment"
              : "Upload attachment";
          return (
            <div key={row.id ?? index} className="py-3 first:pt-2 last:pb-2">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
                <input
                  className="ui-field-standalone col-start-1 row-start-1 min-w-0 sm:col-start-auto sm:row-start-auto"
                  value={row.label}
                  aria-label="Form name"
                  data-example="Appendix A"
                  disabled={disabled}
                  onChange={(event) => patch(index, "label", event.target.value)}
                />
                <input
                  className="ui-field-standalone col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:row-start-auto"
                  value={row.description}
                  aria-label="Form description"
                  data-example="Order escalation approval form"
                  disabled={disabled}
                  onChange={(event) => patch(index, "description", event.target.value)}
                />
                <div className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto">
                  {disabled ? <span className="block w-9" /> : (
                    <RowDeleteButton title="Delete annex row" onClick={() => onRemoveRow(index)} />
                  )}
                </div>
              </div>

              <div className="mt-2 flex min-h-9 items-center gap-2 border-t border-line/70 pt-2">
                {file ? (
                  <button
                    type="button"
                    className="group flex min-w-0 flex-1 items-center gap-2 text-left"
                    title={`Open ${file.originalName}`}
                    onClick={() => onOpen(file)}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center text-ink-secondary">
                      <Paperclip size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-ink group-hover:underline">
                        {file.originalName}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-ink-tertiary">
                        PDF · {formatFileSize(file.sizeBytes)}
                      </span>
                    </span>
                  </button>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center text-ink-tertiary">
                      <Paperclip size={14} />
                    </span>
                    <span className="text-xs text-ink-tertiary">No form attached</span>
                  </div>
                )}
                {disabled ? null : (
                  <div className="flex shrink-0 items-center gap-1">
                    <label
                      className={`ui-btn-ghost inline-flex h-8 w-8 items-center justify-center px-0 ${
                        uploading ? "pointer-events-none cursor-wait opacity-60" : "cursor-pointer"
                      }`}
                      aria-disabled={uploading}
                      aria-label={uploadLabel}
                      title={uploadLabel}
                    >
                      {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                      <span className="sr-only">{uploadLabel}</span>
                      <input
                        type="file"
                        className="sr-only"
                        aria-label={uploadLabel}
                        accept={SOP_ANNEX_FILE_ACCEPT}
                        disabled={uploading}
                        onChange={(event) => {
                          const selected = event.target.files?.[0];
                          if (selected) void onUpload(index, selected);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    {file ? (
                      <button
                        type="button"
                        className="ui-btn-ghost h-8 w-8 px-0 text-ink-tertiary hover:text-danger"
                        title="Remove attachment"
                        aria-label="Remove attachment"
                        onClick={() => onRemoveFile(file)}
                      >
                        <X size={14} />
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
              {rowStatus ? (
                <div
                  role="status"
                  aria-live="polite"
                  className={`mt-2 flex items-center gap-1.5 text-[11px] ${
                    rowStatus.phase === "error"
                      ? "text-danger"
                      : rowStatus.phase === "success"
                        ? "text-success"
                        : "text-ink-secondary"
                  }`}
                >
                  {rowStatus.phase === "saving" || rowStatus.phase === "uploading" ? (
                    <Loader2 size={12} className="shrink-0 animate-spin" />
                  ) : rowStatus.phase === "success" ? (
                    <Check size={12} className="shrink-0" />
                  ) : (
                    <X size={12} className="shrink-0" />
                  )}
                  <span>{rowStatus.phase === "success" ? "Upload complete." : rowStatus.message}</span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {disabled ? null : (
        <AddButton
          label="Add form"
          onClick={() =>
            onChange((current) => [
              ...current,
              { id: newAnnexId(sopId), label: "", description: "" },
            ])
          }
        />
      )}
    </div>
  );
}
function ChangeHistoryEditor({
  rows,
  disabled = false,
  onChange,
}: {
  rows: Sop["changeHistory"];
  disabled?: boolean;
  onChange: (rows: Sop["changeHistory"]) => void;
}) {
  function patch(index: number, field: keyof Sop["changeHistory"][number], value: string) {
    onChange(rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div key={index} className="rounded-md border border-line p-3">
          <div className="grid gap-2 sm:grid-cols-[6rem_minmax(0,1fr)]">
            <input
              className="ui-field-standalone"
              value={row.version}
              placeholder="Version"
              disabled={disabled}
              onChange={(event) => patch(index, "version", event.target.value)}
            />
            <input
              className="ui-field-standalone"
              value={row.changes}
              placeholder="Description of changes"
              disabled={disabled}
              onChange={(event) => patch(index, "changes", event.target.value)}
            />
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_auto]">
            <input
              className="ui-field-standalone"
              value={row.createdByName}
              placeholder="Created by"
              disabled={disabled}
              onChange={(event) => patch(index, "createdByName", event.target.value)}
            />
            <input
              className="ui-field-standalone"
              value={row.createdByPosition}
              placeholder="Position"
              disabled={disabled}
              onChange={(event) => patch(index, "createdByPosition", event.target.value)}
            />
            <input
              type="date"
              required
              className="ui-field-standalone"
              value={row.createdByDate}
              disabled={disabled}
              onChange={(event) => patch(index, "createdByDate", event.target.value)}
            />
            {disabled ? null : (
              <RowDeleteButton title="Remove entry" onClick={() => onChange(rows.filter((_, i) => i !== index))} />
            )}
          </div>
        </div>
      ))}
      {disabled ? null : (
        <AddButton
          label="Add entry"
          onClick={() =>
            onChange([
              ...rows,
              { version: "", changes: "", createdByName: "", createdByPosition: "", createdByDate: "" },
            ])
          }
        />
      )}
    </div>
  );
}
