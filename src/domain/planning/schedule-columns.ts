// Which spreadsheet column holds which schedule field. Pure, no I/O.
//
// Detection is a SUGGESTION the planner confirms, never an assumption. A monthly workbook's
// headers drift, and a silently mis-mapped column would import an entire month into the wrong
// fields — resolving cleanly the whole way, because every value would still be a plausible
// string. Confirming the mapping converts that silent corruption into one visible step.

/** The fields the importer needs from a schedule row. */
export const SCHEDULE_FIELDS = ["model", "customer", "brake", "so", "fgAo", "fgSku", "accSku"] as const;

export type ScheduleField = (typeof SCHEDULE_FIELDS)[number];

/** Column index per field; null = not found, which the planner resolves by hand. */
export type ColumnMapping = Record<ScheduleField, number | null>;

/** Human labels for the mapping UI. */
export const SCHEDULE_FIELD_LABELS: Record<ScheduleField, string> = {
  model: "Model type",
  customer: "Customer",
  brake: "Trailer / brake type",
  so: "Sales order (SO#)",
  fgAo: "Assembly order (A#)",
  fgSku: "FG SKU",
  accSku: "Accessory SKU",
};

/**
 * Header aliases per field, matched against the squashed header text.
 *
 * Order matters: the FIRST field to claim a column wins, and each column is claimed only once.
 * `accSku` is listed before `fgSku` because "ACC SKU" contains "SKU" — without the ordering plus
 * single-claim rule, a loose SKU alias could swallow the accessory column.
 */
const FIELD_ALIASES: ReadonlyArray<readonly [ScheduleField, readonly string[]]> = [
  ["model", ["MODELTYPE", "MODEL", "UNITTYPE"]],
  ["customer", ["CUSTOMERNAME", "CUSTOMER", "ENDCUSTOMER"]],
  ["brake", ["BRAKETYPE", "TRAILERTYPE", "BRAKE", "TRAILER"]],
  ["so", ["SO#", "SONO", "SONUMBER", "SALESORDER", "SO"]],
  ["fgAo", ["FGA#", "FGAO", "ASSEMBLYORDER", "AONO", "A#", "AO"]],
  ["accSku", ["ACCSKU", "ACCESSORYSKU", "ACCITEM", "ACC"]],
  ["fgSku", ["FGSKU", "FGITEM", "FINISHEDGOODSKU", "SKU", "ITEM"]],
];

/** Minimum field matches for a row to be considered the header rather than data. */
const MIN_HEADER_MATCHES = 2;

/** Squash to upper-case alphanumerics (plus #) so spacing and punctuation stop mattering. */
function squash(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).toUpperCase().replace(/[^A-Z0-9#]+/g, "");
}

/** How many distinct fields a row's cells could name. Used to pick the header row. */
function headerScore(row: readonly unknown[]): number {
  const claimed = new Set<ScheduleField>();
  for (const cell of row) {
    const text = squash(cell);
    if (!text) continue;
    for (const [field, aliases] of FIELD_ALIASES) {
      if (claimed.has(field)) continue;
      if (aliases.includes(text)) {
        claimed.add(field);
        break;
      }
    }
  }
  return claimed.size;
}

/**
 * Index of the row that looks most like the header, or -1 when none does. A schedule sheet opens
 * with a title and blank rows, so the header is rarely row 0.
 */
export function detectHeaderRow(rows: readonly (readonly unknown[])[]): number {
  let bestIndex = -1;
  let bestScore = 0;
  rows.forEach((row, index) => {
    const score = headerScore(row);
    if (score >= MIN_HEADER_MATCHES && score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

/**
 * Best-guess column per field. Exact alias matches only — a fuzzy "contains" match is what would
 * let "ACC SKU" satisfy the FG SKU field. Each column is claimed by at most one field, and an
 * unmatched field stays null so the planner sees a gap rather than a wrong column.
 */
export function detectColumnMapping(headerRow: readonly unknown[]): ColumnMapping {
  const mapping = Object.fromEntries(SCHEDULE_FIELDS.map((field) => [field, null])) as ColumnMapping;
  const takenColumns = new Set<number>();

  for (const [field, aliases] of FIELD_ALIASES) {
    for (let column = 0; column < headerRow.length; column += 1) {
      if (takenColumns.has(column)) continue;
      if (aliases.includes(squash(headerRow[column]))) {
        mapping[field] = column;
        takenColumns.add(column);
        break;
      }
    }
  }

  return mapping;
}
