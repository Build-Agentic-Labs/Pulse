import { formatDateControlled } from "@/domain/formatting";
import type { GeneralWorkInstruction } from "@/domain/quality/work-instruction-template";
import { revisionLetter } from "@/domain/work-instruction/release";

export type WiImage = {
  id: string;
  name: string;
  storagePath: string;
  width: number;
  height: number;
  annotations?: unknown;
  url?: string;
};
export type WiStep = {
  id: string;
  position: number;
  title: string;
  instruction: string;
  image: WiImage | null;
};
export type QualityWi = {
  authorName?: string;
  id: string;
  workspaceId: string;
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  title: string;
  purpose: string;
  responsibilities: string;
  documentNumber: string | null;
  version: number;
  hasChanges: boolean;
  publishedRevisionId: string | null;
  updatedAt: string;
  steps: WiStep[];
};
export type WiRevision = {
  authorName?: string;
  id: string;
  revisionIndex: number;
  publishedAt: string;
  changeDescription: string;
  snapshot: GeneralWorkInstruction;
  steps: WiStep[];
};
export type WiEdit =
  | {
      kind: "details";
      payload: Partial<
        Pick<QualityWi, "title" | "purpose" | "responsibilities">
      >;
    }
  | {
      kind: "add_step";
      payload: { id: string; title?: string; instruction?: string };
    }
  | {
      kind: "step";
      payload: { id: string; title?: string; instruction?: string };
    }
  | { kind: "remove_step"; payload: { id: string } }
  | { kind: "reorder"; payload: { ids: string[] } }
  | {
      kind: "image";
      payload: { id: string; image: WiImage | null; dataUrl?: string };
    };
export type PendingWiEdit = {
  operation: string;
  expectedVersion?: number;
  baseVersion?: number;
  issued?: boolean;
  edit: WiEdit;
};

/** Local intent only; no persistence or numbering is performed here. */
export function applyWiEdit(document: QualityWi, edit: WiEdit): QualityWi {
  switch (edit.kind) {
    case "details":
      return { ...document, ...edit.payload, hasChanges: true };
    case "add_step":
      return {
        ...document,
        hasChanges: true,
        steps: [
          ...document.steps,
          {
            id: edit.payload.id,
            position: document.steps.length + 1,
            title: edit.payload.title ?? "",
            instruction: edit.payload.instruction ?? "",
            image: null,
          },
        ],
      };
    case "step":
      return {
        ...document,
        hasChanges: true,
        steps: document.steps.map((step) =>
          step.id === edit.payload.id ? { ...step, ...edit.payload } : step,
        ),
      };
    case "image":
      return {
        ...document,
        hasChanges: true,
        steps: document.steps.map((step) =>
          step.id === edit.payload.id
            ? {
                ...step,
                image: edit.payload.image
                  ? {
                      ...edit.payload.image,
                      ...(edit.payload.dataUrl
                        ? { url: edit.payload.dataUrl }
                        : {}),
                    }
                  : null,
              }
            : step,
        ),
      };
    case "remove_step":
      return {
        ...document,
        hasChanges: true,
        steps: document.steps.filter((step) => step.id !== edit.payload.id),
      };
    case "reorder": {
      if (
        new Set(edit.payload.ids).size !== document.steps.length ||
        edit.payload.ids.length !== document.steps.length ||
        edit.payload.ids.some(
          (id) => !document.steps.some((step) => step.id === id),
        )
      )
        throw new Error("The step list changed.");
      return {
        ...document,
        hasChanges: true,
        steps: edit.payload.ids.map((id, index) => ({
          ...document.steps.find((step) => step.id === id)!,
          position: index + 1,
        })),
      };
    }
  }
}

export function wiPublishProblems(document: QualityWi): string[] {
  const problems: string[] = [];
  if (!document.title.trim()) problems.push("Add a title.");
  if (!document.purpose.trim()) problems.push("Add the purpose / scope.");
  if (!document.responsibilities.trim())
    problems.push("Add the responsibilities.");
  if (!document.steps.length) problems.push("Add at least one step.");
  document.steps.forEach((step, index) => {
    if (!step.title.trim() || !step.instruction.trim())
      problems.push(`Complete step ${index + 1}'s title and instruction.`);
  });
  return problems;
}

export function wiTemplateDocument(
  document: QualityWi,
  revisionIndex = 0,
  revisionDate = "",
  description = "",
): GeneralWorkInstruction {
  return {
    isDraft: revisionIndex === 0,
    authorName: document.authorName,
    title: document.title,
    purpose: document.purpose,
    responsibilities: document.responsibilities,
    documentNumber:
      document.documentNumber ?? `WI-${document.departmentCode}-###`,
    revision: revisionIndex ? revisionLetter(revisionIndex) : "",
    revisionDate: revisionDate ? formatDateControlled(/^\d{4}-\d{2}-\d{2}$/.test(revisionDate) ? `${revisionDate}T12:00:00` : revisionDate) : "",
    revisionDescription: description,
    steps: document.steps.map((step) => ({
      title: step.title,
      instruction: step.instruction,
      ...(step.image ? { image: step.image.id } : {}),
    })),
  };
}

/** Recovery records are untrusted browser data; reject malformed intent without deleting it. */
export function isWiEdit(value: unknown): value is WiEdit {
  if (!value || typeof value !== "object") return false;
  const edit = value as { kind?: unknown; payload?: unknown };
  if (
    !edit.payload ||
    typeof edit.payload !== "object" ||
    Array.isArray(edit.payload)
  )
    return false;
  const p = edit.payload as Record<string, unknown>;
  const fields = (allowed: string[]) =>
    Object.keys(p).every((key) => allowed.includes(key));
  const strings = (keys: string[]) =>
    keys.every((key) => p[key] === undefined || typeof p[key] === "string");
  if (edit.kind === "details")
    return (
      fields(["title", "purpose", "responsibilities"]) &&
      strings(["title", "purpose", "responsibilities"])
    );
  if (edit.kind === "reorder")
    return (
      fields(["ids"]) &&
      Array.isArray(p.ids) &&
      p.ids.every((id) => typeof id === "string")
    );
  if (typeof p.id !== "string" || !p.id) return false;
  if (edit.kind === "add_step" || edit.kind === "step")
    return (
      fields(["id", "title", "instruction"]) &&
      strings(["title", "instruction"])
    );
  if (edit.kind === "remove_step") return fields(["id"]);
  if (
    edit.kind !== "image" ||
    !fields(["id", "image", "dataUrl"]) ||
    (p.dataUrl !== undefined &&
      (typeof p.dataUrl !== "string" ||
        !p.dataUrl.startsWith("data:image/jpeg;base64,")))
  )
    return false;
  if (p.image === null) return true;
  if (!p.image || typeof p.image !== "object" || Array.isArray(p.image))
    return false;
  const image = p.image as Record<string, unknown>;
  return (
    typeof image.id === "string" &&
    typeof image.name === "string" &&
    typeof image.storagePath === "string" &&
    typeof image.width === "number" &&
    image.width > 0 &&
    typeof image.height === "number" &&
    image.height > 0
  );
}
