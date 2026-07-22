/**
 * TYPE-DEPT-NNN document numbers (e.g. `SOP-QAS-014`). The authoritative sequence is minted
 * transactionally in the database (`next_sop_number`); these helpers only format and parse the
 * resulting label for display and for reading the department/type/sequence back out.
 */

export interface ParsedSopNumber {
  dept: string;
  type: string;
  seq: number;
}

/** Build a `TYPE-DEPT-NNN` label. Sequence is zero-padded to at least 3 digits. */
export function formatSopNumber(deptCode: string, docType: string, seq: number): string {
  const pad = String(Math.max(0, Math.trunc(seq))).padStart(3, "0");
  return `${docType.trim().toUpperCase()}-${deptCode.trim().toUpperCase()}-${pad}`;
}

const SOP_NUMBER_RE = /^([A-Z0-9]+)-([A-Z0-9]+)-(\d+)$/;

/** Parse a `TYPE-DEPT-NNN` label, or null if it doesn't match the scheme. */
export function parseSopNumber(value: string): ParsedSopNumber | null {
  const match = SOP_NUMBER_RE.exec(value.trim().toUpperCase());
  if (!match) return null;
  return { dept: match[2], type: match[1], seq: Number(match[3]) };
}
