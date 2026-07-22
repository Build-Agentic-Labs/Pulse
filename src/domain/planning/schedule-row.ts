// Production-schedule ROW PARSING: turns one spreadsheet row's raw cells into typed fields.
// Pure, no I/O. This module knows nothing about product configuration, SKUs or work orders --
// resolution against the config catalog is `schedule-resolve.ts`, one phase later.
//
// Split out of the former `src/domain/schedule-import.ts`. Its other half (customer
// normalization + generator/PM template matching) was deleted: templates are now keyed by SKU,
// and a different customer means a different SKU, so the customer no longer has to be inferred
// from 19 spellings of 10 names. See
// docs/superpowers/specs/2026-07-21-planning-schedule-to-work-order-design.md §5.

/** What a MODEL TYPE string denotes. */
export type ModelKind = "hybrid" | "power_module" | "trailer" | "other" | "blank";

export interface ParsedModel {
  kind: ModelKind;
  /** Hybrid only: the `{A}-{B}` combo (first two numbers of the (E)BOSS name). */
  combo?: string;
  /** Hybrid + standalone PM: the power-module size (`{A}`). */
  pmSize?: string;
  /** Hybrid only: the SDG generator size (`{B}`). */
  genSize?: string;
  /** Trailer only: the SDG size on the trailer line. */
  trailerSize?: string;
  raw: string;
}

/**
 * Classify a MODEL TYPE string. Per the (E)BOSS nomenclature, `(E)BOSS{A}-{B}` is a hybrid
 * whose PM is `{A}` and generator is SDG`{B}`; a name with a size but no dash and a PM marker
 * is a standalone power module; an `SDG… TRAILER/TRLR` is a trailer. Everything else is `other`.
 *
 * Now a VALIDATOR rather than a resolver: the SKU decides what gets built, and this confirms
 * the sheet's model text agrees with the SKU's model.
 */
export function parseModel(model: string): ParsedModel {
  const raw = model ?? "";
  const text = raw.trim();
  if (!text) {
    return { kind: "blank", raw };
  }

  const hybrid = /\bE?BOSS\s*(\d+)-(\d+)/i.exec(text);
  if (hybrid) {
    const [pmSize, genSize] = [hybrid[1], hybrid[2]];
    return { kind: "hybrid", combo: `${pmSize}-${genSize}`, pmSize, genSize, raw };
  }

  // PM / TRLR markers may be glued to the size (e.g. "BOSS400PM", "SDG150TRLR") — the shop's own
  // template library uses those spellings — so we do not require a leading word boundary.
  if (/PM\b|power\s*module/i.test(text)) {
    const size = /(\d+)/.exec(text)?.[1];
    return { kind: "power_module", pmSize: size, raw };
  }

  if (/trailer|trlr/i.test(text)) {
    const size = /(\d+)/.exec(text)?.[1];
    return { kind: "trailer", trailerSize: size, raw };
  }

  return { kind: "other", raw };
}

/** Squash to upper-case alphanumerics so spelling/punctuation/spacing differences collapse. */
function squash(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

/**
 * A trailer configuration letter from the catalog. The catalog itself is editable
 * (`trailer_configs`), so this is the shape of a letter, not the enumeration of them.
 */
export type TrailerLetter = string;

/**
 * Normalize a BRAKE TYPE / trailer-type string to a trailer config letter, or "none" (PM lines /
 * not applicable). Plain "Hydraulic" folds into the surge/hydraulic trailer.
 *
 * NOTE: the returned letters must exist in the workspace's `trailer_configs` catalog. The
 * resolver flags a letter the catalog does not contain rather than letting it dangle.
 */
export function normalizeBrake(raw: string): TrailerLetter | "none" {
  const squashed = squash(raw ?? "");
  if (squashed.startsWith("ELECTRIC")) {
    return "E";
  }
  if (squashed.includes("SURGE") || squashed.includes("HYDRAULIC")) {
    return "S";
  }
  return "none";
}

/**
 * Clean a SO# value: extract the sales order (dropping trailing transfer text like " TO5745"),
 * keep a bare transfer order as-is (trailer stock), and flag NEED/blank as a missing SO.
 */
export function cleanSo(raw: string): { so: string; flag: boolean } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || /^need\b/i.test(trimmed)) {
    return { so: "", flag: true };
  }
  const salesOrder = /S-?ORD\s*\d+/i.exec(trimmed);
  if (salesOrder) {
    return { so: salesOrder[0].replace(/\s+/g, ""), flag: false };
  }
  return { so: trimmed, flag: false };
}

/** Whether an assembly-order value is entered (`A#####`) or still needs one (NEED…/blank). */
export function aoStatus(raw: string): "ok" | "flag" {
  return /^A\d/i.test((raw ?? "").trim()) ? "ok" : "flag";
}

/**
 * A production-schedule sheet has category divider rows (a `PLANNED WEEKLY BUILDS` label like
 * "TRAILERS" or "STOCK", no unit data). Such a row carries no MODEL/SO/CUSTOMER/A# and must be
 * skipped, not imported. A blank model WITH unit data present is a real line (flagged), not a divider.
 *
 * Divider rows are never stored as `sales_order_lines`, which is exactly why the export column
 * walks the import's ROW RANGE: their row numbers simply have no record, so those cells come out
 * blank instead of shifting every id below them up one row.
 */
export function isSectionHeaderRow(fields: { model: string; so: string; customer: string; fgAo: string }): boolean {
  return !fields.model.trim() && !fields.so.trim() && !fields.customer.trim() && !fields.fgAo.trim();
}
