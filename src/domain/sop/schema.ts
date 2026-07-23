/**
 * Canonical SOP data model.
 *
 * Derived directly from the company standard template (`assets/sop-template.docx`,
 * "SOP-QAS-00X: QMS"). This type is the single source of truth for the whole SOP
 * feature: the create/edit form edits a `Sop`, the legacy-document converter maps
 * old PDFs/DOCX *into* a `Sop`, and the DOCX exporter fills the template *from* a
 * `Sop`. Change the company standard => change this file first.
 */

// ---------------------------------------------------------------------------
// RASIC — the responsibility legend used in the Procedure section.
// R: Responsible. A: Approve. S: Support. I: Inform. C: Consult.
// ---------------------------------------------------------------------------

export const RASIC_CODES = ["R", "A", "S", "I", "C"] as const;
export type RasicCode = (typeof RASIC_CODES)[number];

export const RASIC_LABELS: Record<RasicCode, string> = {
  R: "Responsible",
  A: "Approve",
  S: "Support",
  I: "Inform",
  C: "Consult",
};

/** "R: Responsible · A: Approve · …" — the legend shown in the editor and export. */
export function rasicLegend(separator = "  ·  "): string {
  return RASIC_CODES.map((code) => `${code}: ${RASIC_LABELS[code]}`).join(separator);
}

// ---------------------------------------------------------------------------
// Lifecycle status
// ---------------------------------------------------------------------------

export const SOP_STATUSES = ["draft", "in_review", "approved", "effective", "obsolete"] as const;
export type SopStatus = (typeof SOP_STATUSES)[number];

export const SOP_STATUS_LABELS: Record<SopStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  effective: "Effective",
  obsolete: "Obsolete",
};

// ---------------------------------------------------------------------------
// Header / document metadata
// ---------------------------------------------------------------------------

export interface SopMeta {
  /** Document number, e.g. "SOP-QAS-001". */
  sopNumber: string;
  /** Short title, e.g. "QMS". */
  title: string;
  /** e.g. "1.0". */
  version: string;
  /** Stored ISO (YYYY-MM-DD); rendered as MM/DD/YY in the template. */
  revisionDate: string;
  /** Stored ISO (YYYY-MM-DD); rendered as MM/DD/YY in the template. */
  effectiveDate: string;
}

// ---------------------------------------------------------------------------
// Body sections
// ---------------------------------------------------------------------------

export interface SopDefinition {
  /** e.g. "QMS". */
  term: string;
  /** e.g. "Quality Management System". */
  definition: string;
}

/** Flowchart shape of a process step: terminator (start/end pill), process (rectangle), decision (diamond). */
export type SopShape = "terminator" | "process" | "decision";

/** One step (row) of the Procedure process map: input -> process step -> output, plus RASIC. */
export interface SopActivity {
  id: string;
  /** 1-based display order. */
  step: number;
  /** Flowchart shape; defaults to "process". */
  shape?: SopShape;
  /** Input(s) to this step — left column of the process map. */
  input?: string;
  /** Short action label shown in the flowchart box. */
  description: string;
  /** Fuller explanation rendered in the written procedure list under the diagram (box stays short). */
  detail?: string;
  /** Output(s) of this step — right column of the process map. */
  output?: string;
  /** Role name -> responsibility code. Keys come from `SopProcedure.roles`. */
  assignments: Record<string, RasicCode>;
}

export interface SopProcedure {
  /** Optional narrative / caption for the process-flow diagram. */
  processFlowDescription: string;
  /** Uploaded diagram image, stored as a key/URL (resolved at render time). */
  processFlowImageKey?: string;
  /** Column headers of the RASIC matrix (the functions/roles involved). */
  roles: string[];
  activities: SopActivity[];
}

/**
 * A structured link to another SOP in the same workspace ("related documents").
 * `sopId` is the live pointer; number/title are a display snapshot taken when the
 * link is created so preview/export render without a lookup (and keep rendering
 * if the target is later deleted).
 */
export interface SopLinkedSop {
  /** App-internal id of the referenced SOP row (`sops.id`). */
  sopId: string;
  sopNumber: string;
  title: string;
}

/** "SOP-QAS-001 — QMS" (degrades gracefully when either half is blank). */
export function linkedSopLabel(link: SopLinkedSop): string {
  if (link.sopNumber && link.title) return `${link.sopNumber} — ${link.title}`;
  return link.sopNumber || link.title || link.sopId;
}

/**
 * An uploaded document referenced by the SOP. The binary lives in the same
 * storage/table as annex forms (`sop_annex_files`, keyed by this row's id in the
 * `annex_id` slot); the document keeps only the id + display name so preview and
 * export render without a lookup.
 */
export interface SopReferenceDoc {
  id: string;
  /** Display name, seeded from the uploaded file's name. */
  name: string;
}

/** An appendix / attached form referenced by the SOP. */
export interface SopAnnex {
  /** Stable editor identity used to link a private uploaded form to this row. */
  id?: string;
  /** e.g. "Appendix A". */
  label: string;
  description: string;
}

/** One row of the Change History table. */
export interface SopChangeEntry {
  version: string;
  changes: string;
  createdByName: string;
  createdByPosition: string;
  /** Stored ISO (YYYY-MM-DD). */
  createdByDate: string;
}

/**
 * The approval roles in the template's "Change Approvals" table. Modeled as a
 * suggested-but-extensible list so a workspace can add/rename rows without a
 * schema change.
 */
export const DEFAULT_APPROVAL_ROLES = [
  "Reviewed By",
  "Department Manager Release",
  "Associated Department",
  "Associated Department",
  "Quality Approval",
] as const;

export interface SopApproval {
  /** e.g. "Quality Approval". */
  role: string;
  name: string;
  position: string;
  /** Stored ISO (YYYY-MM-DD). */
  date: string;
}

// ---------------------------------------------------------------------------
// Top-level document
// ---------------------------------------------------------------------------

export interface Sop {
  /** App-internal id (not the human SOP number). */
  id: string;
  meta: SopMeta;

  purpose: string;
  scope: string;
  definitions: SopDefinition[];
  /** Functions responsible to carry out this process. */
  responsiblePersons: string[];
  references: string[];
  /** Other SOPs this document references; rendered with `references` in preview/export. */
  linkedSops: SopLinkedSop[];
  /** Uploaded documents this SOP references; rendered with `references` in preview/export. */
  referenceDocs: SopReferenceDoc[];
  /** KPI lines, e.g. "% of released SOPs". */
  measurements: string[];
  procedure: SopProcedure;
  annexes: SopAnnex[];
  changeHistory: SopChangeEntry[];
  approvals: SopApproval[];

  /** Provenance: was this hand-authored or converted from a legacy file? */
  source: "authored" | "converted";
  /**
   * Lifecycle state. Persisted as the promoted `sops.status` column (like the header
   * fields), NOT inside the jsonb document -- the store strips it on save and overlays
   * the column on load.
   */
  status: SopStatus;
  createdAt: string;
  updatedAt: string;
}

/** A blank SOP pre-seeded with the standard approval rows. */
export function createEmptySop(id: string, now: string): Sop {
  return {
    id,
    meta: { sopNumber: "", title: "", version: "1.0", revisionDate: "", effectiveDate: "" },
    purpose: "",
    scope: "",
    definitions: [],
    responsiblePersons: [],
    references: [],
    linkedSops: [],
    referenceDocs: [],
    measurements: [],
    procedure: { processFlowDescription: "", roles: [], activities: [] },
    annexes: [],
    changeHistory: [],
    approvals: DEFAULT_APPROVAL_ROLES.map((role) => ({ role, name: "", position: "", date: "" })),
    source: "authored",
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
}
