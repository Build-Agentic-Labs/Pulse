/**
 * Line classification for the SOP Procedure narrative.
 *
 * Converted documents store the Procedure as clean text — no markup. Structure
 * is DETECTED, not marked: numbered sub-headings ("4.4 Document Creation")
 * identify themselves by shape, and bullets are the one stored convention — a
 * leading "• " (or the "- " an author types by hand). This keeps the string
 * presentation-clean in every surface that renders it raw (editor textarea,
 * search, fallback preview) while the preview, the DOCX export, and the
 * backfill verifier all share this single definition of what a line is.
 *
 * The heading rule is deliberately conservative: a missed heading renders as
 * an ordinary paragraph (today's behaviour); a false positive would mis-bold a
 * controlled document. Hence: at least two numeric levels (so "4 bolts secure
 * the cover" can never match), an uppercase letter right after the number (so
 * "4.5 mm tolerance applies." stays prose), no terminal period (so
 * "4.4 Insert the pin." stays an instruction), and a length cap.
 */

export type ProcedureLineKind = "heading" | "bullet" | "paragraph";

export interface ClassifiedProcedureLine {
  kind: ProcedureLineKind;
  /** Display text: bullet glyph stripped for bullets, verbatim otherwise. */
  text: string;
}

const HEADING_PATTERN = /^\d+(\.\d+)+\s+[A-Z]/;
const HEADING_MAX_LENGTH = 80;
const BULLET_PATTERN = /^([•-])\s+(\S.*)$/;

export function classifyProcedureLine(line: string): ClassifiedProcedureLine {
  const trimmed = line.trim();

  const bullet = BULLET_PATTERN.exec(trimmed);
  if (bullet) {
    return { kind: "bullet", text: bullet[2] };
  }

  if (
    HEADING_PATTERN.test(trimmed) &&
    trimmed.length <= HEADING_MAX_LENGTH &&
    !trimmed.endsWith(".")
  ) {
    return { kind: "heading", text: trimmed };
  }

  return { kind: "paragraph", text: line };
}
