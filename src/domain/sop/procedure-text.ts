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
 * controlled document. Hence: a dotted numeric label (so "4 bolts secure
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

const HEADING_PATTERN = /^\d+(?:(?:\.\d+)+|\.)\s+[A-Z]/;
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

/** Renumber detected procedure headings at render time, retaining source labels for references. */
export function formatProcedureText(value: string): string {
  const lines = value.split(/\r?\n/);
  const labels = new Map<string, string>();
  let next = 0;
  for (const line of lines) {
    if (classifyProcedureLine(line).kind !== 'heading') continue;
    const label = line.trim().match(/^\d+(?:\.\d+)*/)?.[0];
    if (label && !labels.has(label)) labels.set(label, String(++next));
  }
  return lines.map((line) => {
    if (classifyProcedureLine(line).kind === 'heading') {
      line = line.trim().replace(/^(\d+(?:\.\d+)*)(?:\.)?/, (_match, label: string) => `${labels.get(label)}.`);
    }
    // Only explicit local section references; never rewrite measurements or external citations.
    return line.replace(/\b(section|step|subsection)\s+(\d+(?:\.\d+)+)\b/gi,
      (match, kind: string, label: string) => labels.has(label) ? `${kind} ${labels.get(label)}` : match);
  }).join('\n');
}
