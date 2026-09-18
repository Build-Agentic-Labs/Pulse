/**
 * Reference documents linked to a work instruction — the pure half.
 *
 * A reference is a Pulse SOP (picked, so the sheet always shows its current number and version),
 * a drawing, another controlled document, or a plain link. They print in the setup band's
 * "Reference documents" block and are frozen into every release.
 *
 * Spec: docs/superpowers/specs/2026-09-18-work-instruction-release-design.md
 */

import type { WorkInstructionReferenceDoc, WorkInstructionReferenceKind } from "./schema";

export const REFERENCE_KINDS: readonly WorkInstructionReferenceKind[] = ["sop", "drawing", "document", "link"];

export const REFERENCE_KIND_LABELS: Record<WorkInstructionReferenceKind, string> = {
  sop: "SOP",
  drawing: "Drawing",
  document: "Document",
  link: "Link",
};

/** A stored reference, with its SOP (when it has one) resolved to current values. */
export interface WorkInstructionReferenceRecord {
  id: string;
  taskId: string;
  kind: WorkInstructionReferenceKind;
  sopId: string | null;
  documentNumber: string;
  title: string;
  url: string;
  position: number;
  /** Present when `sopId` still resolves to a readable SOP. */
  sop?: { number: string; title: string; version: string; status: string };
  /** Present when a file is stored in Pulse for this reference. */
  file?: WorkInstructionReferenceFile;
}

export interface WorkInstructionReferenceFile {
  storagePath: string;
  name: string;
  contentType: string;
  sizeBytes: number;
}

export interface ReferenceInput {
  kind: WorkInstructionReferenceKind;
  sopId?: string | null;
  documentNumber?: string;
  title?: string;
  url?: string;
  /** Name of the file being uploaded with this reference, if any. */
  fileName?: string;
}

export interface NormalizedReferenceInput {
  kind: WorkInstructionReferenceKind;
  sopId: string | null;
  documentNumber: string;
  title: string;
  url: string;
}

const HTTP_URL = /^https?:\/\/\S+$/i;

/** Clean a reference for saving, or explain in a sentence why it cannot be saved. */
export function normalizeReferenceInput(input: ReferenceInput): { value: NormalizedReferenceInput } | { error: string } {
  if (!REFERENCE_KINDS.includes(input.kind)) return { error: "Choose what kind of reference this is." };
  const documentNumber = (input.documentNumber ?? "").trim().slice(0, 80);
  const fileName = (input.fileName ?? "").trim();
  // An uploaded file with nothing typed is labelled by its own name.
  const typedTitle = (input.title ?? "").trim();
  const title = (typedTitle || (documentNumber ? "" : fileName)).slice(0, 200);
  const url = (input.url ?? "").trim();
  const sopId = input.kind === "sop" ? (input.sopId ?? "").trim() || null : null;

  if (input.kind === "sop" && !sopId) return { error: "Choose the SOP to reference." };
  if (input.kind !== "sop" && !title && !documentNumber) return { error: "Enter a document number or a title." };
  if (fileName && !referenceKindAcceptsFile(input.kind)) return { error: "Attach files to a drawing or a document reference." };
  if (input.kind === "link" && !url) return { error: "Enter the link address." };
  if (url && !HTTP_URL.test(url)) return { error: "Links must start with http:// or https://." };
  if (url.length > 2000) return { error: "That link is too long." };

  return { value: { kind: input.kind, sopId, documentNumber, title, url } };
}

/**
 * The task's legacy free-text links, as references. A value that is a URL becomes the link; any
 * other text ("DWG-EB125-1140 rev C") is a document number.
 */
function legacyReference(kind: WorkInstructionReferenceKind, value: string | undefined): WorkInstructionReferenceDoc[] {
  const text = (value ?? "").trim();
  if (!text) return [];
  return [HTTP_URL.test(text) ? { kind, documentNumber: "", title: "", url: text } : { kind, documentNumber: text, title: "", url: "" }];
}

/**
 * Everything the sheet lists under "Reference documents": the task's two legacy links first
 * (drawing, governing SOP), then the managed references in their saved order. An SOP reference
 * shows the SOP's current number, title and version, falling back to the label stored on the row
 * when the SOP is no longer readable.
 */
export function referencesForSetup(
  legacy: { drawingLink?: string; sopLink?: string },
  records: readonly WorkInstructionReferenceRecord[],
): WorkInstructionReferenceDoc[] {
  const managed = [...records]
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
    .map<WorkInstructionReferenceDoc>((record) => ({
      kind: record.kind,
      documentNumber: record.sop?.number || record.documentNumber,
      title: record.sop?.title || record.title,
      ...(record.sop?.version ? { version: record.sop.version } : {}),
      url: record.url,
      ...(record.file ? { fileName: record.file.name } : {}),
    }));
  return [...legacyReference("drawing", legacy.drawingLink), ...legacyReference("sop", legacy.sopLink), ...managed];
}

/** One printed line: "QAS-SOP-004 v2.0 · Document & Records Control". */
export function referenceLine(reference: WorkInstructionReferenceDoc): string {
  const number = [reference.documentNumber, reference.version ? `v${reference.version.replace(/^v/i, "")}` : ""]
    .filter(Boolean)
    .join(" ");
  return [number, reference.title].filter(Boolean).join(" · ") || reference.url;
}

/** Must match the wi-reference-files bucket's file_size_limit and the table's CHECK. */
export const REFERENCE_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const REFERENCE_FILE_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png";

const REFERENCE_FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

/** A file belongs on a drawing or a document; an SOP is picked and a link is an address. */
export function referenceKindAcceptsFile(kind: WorkInstructionReferenceKind): boolean {
  return kind === "drawing" || kind === "document";
}

/**
 * The content type the bucket will accept for this file, judged by its EXTENSION (browsers report
 * an empty or wrong type for Office files often enough that the name is the better witness), or
 * null when the file cannot be stored.
 */
export function referenceFileContentType(fileName: string): string | null {
  if (!fileName.includes(".")) return null;
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return REFERENCE_FILE_TYPES[extension] ?? null;
}

/** Why this file cannot be attached, as a sentence, or null when it can. */
export function referenceFileProblem(file: { name: string; size: number }): string | null {
  if (file.size <= 0) return "The selected file is empty.";
  if (file.size > REFERENCE_FILE_MAX_BYTES) return `Files must be ${REFERENCE_FILE_MAX_BYTES / (1024 * 1024)} MB or smaller.`;
  if (!referenceFileContentType(file.name)) return "Choose a PDF, Word, Excel, CSV, JPG or PNG file.";
  return null;
}

function safeFileName(fileName: string): string {
  const match = /^(.*?)(\.[a-zA-Z0-9]+)?$/.exec(fileName) ?? [];
  const stem =
    (match[1] ?? fileName)
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "file";
  return `${stem}${(match[2] ?? "").toLowerCase()}`;
}

/**
 * Object name for a reference file:
 * `workspaces/<ws>/projects/<project>/wi-references/<task>/<uploadId>-<name>`.
 * The workspace, project and task segments are used verbatim because Storage RLS and the table
 * trigger compare them exactly; only the file name is sanitised.
 */
export function buildReferenceFilePath(input: {
  workspaceId: string;
  projectId: string;
  taskId: string;
  uploadId: string;
  fileName: string;
}): string {
  for (const [label, value] of [
    ["workspace id", input.workspaceId],
    ["project id", input.projectId],
    ["task id", input.taskId],
    ["upload id", input.uploadId],
  ] as const) {
    if (!value || value.includes("/")) throw new Error(`Cannot build a reference file path: invalid ${label}.`);
  }
  return `workspaces/${input.workspaceId}/projects/${input.projectId}/wi-references/${input.taskId}/${input.uploadId}-${safeFileName(input.fileName)}`;
}

/**
 * Download name for types the browser cannot show inline. PDFs and images open as a tab preview
 * (undefined); everything else downloads under its original name rather than the storage key.
 */
export function referenceDownloadName(file: Pick<WorkInstructionReferenceFile, "contentType" | "name">): string | undefined {
  if (file.contentType === "application/pdf" || file.contentType.startsWith("image/")) return undefined;
  return file.name.trim() || "download";
}
