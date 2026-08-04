/**
 * Mechanical safety net for the assisted procedure-text backfill
 * (spec 2026-08-04). The model is instructed to restructure ONLY — restore
 * paragraph breaks, put list items on "• " lines — never to reword. This
 * verifier enforces that contract the same way assertSaneStateDeletion guards
 * the planner save path: a drifted restructure fails loudly and is excluded.
 *
 * The projection keeps letters and digits only (Unicode-aware), so whitespace,
 * bullet glyphs, and punctuation separators — the things restructuring
 * legitimately moves or replaces — are invisible to it, while any reworded,
 * dropped, or reordered CONTENT changes the projection and fails.
 */

/** Letters-and-digits-only projection, lowercased. */
function contentProjection(text: string): string {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).join("").toLowerCase();
}

export function restructurePreservesWording(before: string, after: string): boolean {
  return contentProjection(before) === contentProjection(after);
}

/** The restructure-only instruction the backfill sends alongside each SOP's text. */
export const RESTRUCTURE_INSTRUCTION = `You are restructuring the Procedure narrative of a controlled SOP document. The text lost its formatting during a document conversion: paragraph breaks may be collapsed, list items may be run together, numbered sub-headings may be buried mid-line.

Return the SAME text with ONLY its structure restored:
- Put each numbered sub-heading (like "4.4 Document Creation") on its own line, exactly as written.
- Put each list item on its own line starting with "• " (bullet + space). Convert run-together lists (comma- or semicolon-joined items, often Capitalized) into bullet lines.
- Separate paragraphs with one blank line.
- NEVER reword, summarize, reorder, add, or drop content. Every letter and digit of the original must appear, in order. Separator punctuation (the commas or semicolons that joined run-together list items) may be dropped when the items become bullet lines; all other punctuation stays.

Return ONLY the restructured text — no commentary, no code fences.`;
