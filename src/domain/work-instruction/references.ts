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
}

export interface ReferenceInput {
  kind: WorkInstructionReferenceKind;
  sopId?: string | null;
  documentNumber?: string;
  title?: string;
  url?: string;
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
  const title = (input.title ?? "").trim().slice(0, 200);
  const url = (input.url ?? "").trim();
  const sopId = input.kind === "sop" ? (input.sopId ?? "").trim() || null : null;

  if (input.kind === "sop" && !sopId) return { error: "Choose the SOP to reference." };
  if (input.kind !== "sop" && !title && !documentNumber) return { error: "Enter a document number or a title." };
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
