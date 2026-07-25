/**
 * The responsible-persons roster is stored as `string[]` and edited as one entry per line.
 *
 * These two functions are the whole contract between the textarea and the array, and they exist
 * as domain rather than inline in the editor because "what counts as an entry" is a decision:
 * blank lines are separators the author typed, not empty roster entries, and an empty string in
 * the array renders as a blank line on the controlled document.
 *
 * Note what parsing deliberately does NOT do: split on `;`. The previous single-line editor
 * wrote the entire typed value as one element, so existing rows hold `"A; B; C"`. Splitting
 * those here would silently tear apart any role that legitimately contains a semicolon, and the
 * editor would show something other than what is stored. Those rows are repaired by migration
 * (20260725190000) instead.
 */

/** Split a textarea value into roster entries: one per line, trimmed, blanks dropped. */
export function parseResponsiblePersons(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Render roster entries back into a textarea value, one per line. */
export function formatResponsiblePersons(entries: readonly string[]): string {
  return entries.join("\n");
}
