/**
 * Smart Title Case formatting for tool names, plus the single canonical key
 * function that ALL tool-name comparisons must route through.
 *
 * `formatToolName` only ever changes casing and whitespace — never letters — so
 * it is idempotent. `canonicalToolKey` is whitespace- and case-insensitive, so
 * that messy stored names and their formatted display form always compare equal.
 */

/**
 * Manufacturing acronyms that stay uppercase regardless of how they were typed.
 * The convenience rule (all-caps tokens <= 4 chars are kept) already covers most
 * machining acronyms; this allowlist is the explicit extension point, primarily
 * for acronyms longer than 4 characters.
 */
export const TOOL_ACRONYMS = new Set<string>([
  "HSS",
  "CRES",
  "NPT",
  "EDM",
  "CMM",
  "OEM",
  "NM",
  "ID",
  "OD",
  "ANSI",
  "OAL",
]);

const SMALL_WORDS = new Set<string>([
  "of",
  "and",
  "the",
  "to",
  "for",
  "in",
  "on",
  "with",
  "per",
  "a",
  "an",
  "or",
  "vs",
  "x", // dimension separator: 2in x 4in
]);

function hasDigit(token: string): boolean {
  return /\d/.test(token);
}

function uppercaseLeadingLetters(token: string): string {
  const match = token.match(/^[a-zA-Z]+/);
  if (!match) {
    return token;
  }
  const run = match[0];
  return run.toUpperCase() + token.slice(run.length);
}

function titleCaseWord(word: string): string {
  const lower = word.toLocaleLowerCase();
  const firstLetter = lower.search(/[a-zA-Z]/);
  if (firstLetter === -1) {
    return lower;
  }
  return lower.slice(0, firstLetter) + lower.charAt(firstLetter).toUpperCase() + lower.slice(firstLetter + 1);
}

function titleCaseToken(token: string): string {
  return token
    .split("-")
    .map((part) => titleCaseWord(part))
    .join("-");
}

function formatToken(token: string, isFirst: boolean): string {
  if (token.length === 0) {
    return token;
  }

  // Sizes / codes: any token containing a digit is preserved.
  if (hasDigit(token)) {
    return /^\d/.test(token) ? token : uppercaseLeadingLetters(token);
  }

  // Known acronyms keep their canonical uppercase form, however they were typed.
  const upper = token.toUpperCase();
  if (TOOL_ACRONYMS.has(upper)) {
    return upper;
  }

  // All-caps tokens: short ones are acronyms; longer ones are shouted words.
  const isAllCaps = token === upper && /[A-Z]/.test(token);
  if (isAllCaps) {
    return token.length <= 4 ? token : titleCaseToken(token);
  }

  // Small connector words stay lowercase unless they lead the name.
  if (!isFirst && SMALL_WORDS.has(token.toLocaleLowerCase())) {
    return token.toLocaleLowerCase();
  }

  return titleCaseToken(token);
}

// Zero-width and soft-hyphen characters that make two names look identical while
// differing byte-for-byte.
const INVISIBLE_CHARS = /[​-‍﻿­]/g;

// Length-of-measure units that attach to a number (used for spacing collapse).
// Note: `m` is meters (millimeters are `mm`); the `\b` boundary keeps it from
// matching inside words like "metric" or "motor".
const SIZE_UNITS = "mm|cm|in|ft|m|nm|mil|ga|awg|pt";
const NUMBER_UNIT_SPACING = new RegExp(`(\\d)\\s+(${SIZE_UNITS})\\b`, "gi");

function normalizeUnits(value: string): string {
  return (
    value
      // Inch punctuation / spelling after a number -> "in": 1/2" and 1/2 inch -> 1/2in.
      .replace(/(\d)\s*"/g, "$1in")
      .replace(/(\d)\s*inch(?:es)?\b/gi, "$1in")
      // Collapse the space between a number and its unit: 10 mm -> 10mm.
      .replace(NUMBER_UNIT_SPACING, "$1$2")
  );
}

export function formatToolName(raw: string): string {
  const collapsed = raw
    .normalize("NFC")
    .replace(INVISIBLE_CHARS, "")
    .trim()
    .replace(/\s+/g, " ");
  if (collapsed.length === 0) {
    return "";
  }

  return normalizeUnits(collapsed)
    .split(" ")
    .map((token, index) => formatToken(token, index === 0))
    .join(" ");
}

/**
 * The one canonical key every tool-name comparison must use: dedup in the
 * catalog, the per-name usage counter, the library/registry lookups, and the
 * rename matcher. Builds on `formatToolName` (so unit/whitespace/case variants
 * already agree) and additionally folds hyphens and spaces together, so
 * "t-handle" and "t handle" resolve to the same key while their display forms
 * stay as typed.
 */
export function canonicalToolKey(raw: string): string {
  return formatToolName(raw)
    .replace(/[-\s]+/g, " ")
    .trim()
    .toLocaleLowerCase();
}
