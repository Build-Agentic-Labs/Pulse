/**
 * Legacy-document conversion sources: where the browser parks the .docx/.pdf before asking
 * the extraction route to convert it, and how the route recognises a path it may trust.
 *
 * The file rides through a private Storage bucket instead of the request body because Vercel
 * rejects function bodies over 4.5 MB with a plain-text 413 — photo-heavy legacy SOPs never
 * reached the route at all. Storage RLS (20260916120000) is the enforcement layer: a user may
 * only touch objects under `users/<own uid>/`, and may only write under a workspace where they
 * hold org-tool edit access. The helpers here mirror those rules for UX and for a clear error.
 */

export const SOP_CONVERSION_UPLOAD_BUCKET = "sop-conversion-uploads";

/** Must match the bucket's file_size_limit and the route's cap. */
export const SOP_CONVERSION_MAX_BYTES = 20 * 1024 * 1024;

export type SopConversionContentType =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Content type the bucket accepts for this file name, or null when it is not convertible. */
export function conversionContentType(fileName: string): SopConversionContentType | null {
  if (/\.docx$/i.test(fileName)) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (/\.pdf$/i.test(fileName)) return "application/pdf";
  return null;
}

const PATH_ROOT = "users";
const MAX_STEM_CHARS = 100;

function safeStem(stem: string): string {
  const cleaned = stem
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_STEM_CHARS);
  return cleaned || "document";
}

/**
 * Object name for a conversion source: `users/<userId>/<workspaceId>/<uploadId>-<file>`.
 * The uid and workspace segments are used verbatim because Storage RLS compares them
 * exactly; the file name is sanitised while keeping its extension (the route detects the
 * document kind from it).
 */
export function buildConversionUploadPath(input: {
  userId: string;
  workspaceId: string;
  uploadId: string;
  fileName: string;
}): string {
  for (const [label, value] of [
    ["user id", input.userId],
    ["workspace id", input.workspaceId],
    ["upload id", input.uploadId],
  ] as const) {
    if (!value || value.includes("/")) {
      throw new Error(`Cannot build a conversion upload path: invalid ${label}.`);
    }
  }
  const match = /^(.*?)(\.[a-zA-Z0-9]+)?$/.exec(input.fileName) ?? [];
  const stem = safeStem(match[1] ?? input.fileName);
  const extension = (match[2] ?? "").toLowerCase();
  return `${PATH_ROOT}/${input.userId}/${input.workspaceId}/${input.uploadId}-${stem}${extension}`;
}

export interface ParsedConversionUploadPath {
  userId: string;
  workspaceId: string;
  fileName: string;
}

/** Split a conversion object name back into its parts, or null when it is not one of ours. */
export function parseConversionUploadPath(path: string): ParsedConversionUploadPath | null {
  const segments = path.split("/");
  if (segments.length !== 4 || segments[0] !== PATH_ROOT) return null;
  const [, userId, workspaceId, fileName] = segments;
  if (!userId || !workspaceId || !fileName) return null;
  return { userId, workspaceId, fileName };
}

/**
 * Turn a failed conversion response into a sentence for the user. The route answers JSON with
 * an `error` field, but infrastructure in front of it (Vercel's body-size guard, a gateway
 * timeout, an HTML error page) answers plain text — parsing that as JSON is what produced
 * "Unexpected token 'R', 'Request En'... is not valid JSON".
 */
export function conversionFailureMessage(status: number, bodyText: string): string {
  const trimmed = bodyText.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
    } catch {
      // Fall through to the status-based message.
    }
  }
  if (status === 413) {
    return `This document is too large to convert. The maximum size is ${
      SOP_CONVERSION_MAX_BYTES / (1024 * 1024)
    } MB.`;
  }
  if (status === 401) return "Your session expired. Sign in again, then retry the conversion.";
  if (status === 504) return "The conversion timed out. Try again, or split the document into smaller SOPs.";
  const looksLikeMarkup = trimmed.startsWith("<");
  const detail = !looksLikeMarkup && trimmed ? `: ${trimmed.slice(0, 120)}` : "";
  return `Conversion failed (HTTP ${status})${detail}`;
}
