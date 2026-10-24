import type { PfmeaDocument, PfmeaRow } from './pfmea';
import { samePfmeaValue } from './pfmea-save-queue';

export const PFMEA_EDITABLE_CELL_FIELDS = [
  'failureMode', 'effect', 'severity', 'cause', 'occurrence', 'currentControls',
  'detection', 'detectionActivity', 'recommendedActions', 'actionOwner', 'actionOwnerId',
  'targetDate', 'actionsTaken', 'resultOccurrence', 'resultDetection', 'verificationNotes',
  'actionStatus', 'archivedAt',
] as const satisfies readonly (keyof PfmeaRow)[];
export type PfmeaEditableCellField = typeof PFMEA_EDITABLE_CELL_FIELDS[number];
export type PfmeaCellVersion = { version: number; mutationId: string };
export type PfmeaCellVersions = Record<string, Partial<Record<PfmeaEditableCellField | 'verifiedAt', PfmeaCellVersion>>>;
export type PfmeaCellChange = {
  rowId: string; field: PfmeaEditableCellField; expectedVersion: number;
  previous: string | number | null; value: string | number | null;
};

/** Existing risk rows only. Creation, metadata, and verification use separate commands. */
export function buildPfmeaCellChanges(base: PfmeaDocument, edited: PfmeaDocument, versions: PfmeaCellVersions = {}): PfmeaCellChange[] {
  if (base.id !== edited.id || base.productId !== edited.productId) throw new Error('PFMEA scope changed.');
  const { rows: _baseRows, updatedAt: _baseStamp, cellVersions: _baseVersions, commandReceipts: _baseReceipts, ...baseMetadata } = base;
  const { rows: _editedRows, updatedAt: _editedStamp, cellVersions: _editedVersions, commandReceipts: _editedReceipts, ...editedMetadata } = edited;
  if (!samePfmeaValue(baseMetadata, editedMetadata)) throw new Error('Document metadata requires a separate PFMEA command.');
  const before = new Map(base.rows.map(row => [row.id, row]));
  if (base.rows.length !== before.size || new Set(edited.rows.map(row => row.id)).size !== before.size || edited.rows.length !== before.size || edited.rows.some(row => !before.has(row.id))) throw new Error('Row creation or removal requires a separate PFMEA command.');
  const changes: PfmeaCellChange[] = [];
  for (const row of edited.rows) {
    const prior = before.get(row.id)!;
    for (const key of new Set([...Object.keys(prior), ...Object.keys(row)])) {
      if (key === 'updatedAt' || key === 'verifiedAt' || (PFMEA_EDITABLE_CELL_FIELDS as readonly string[]).includes(key)) continue;
      if (!samePfmeaValue(prior[key as keyof PfmeaRow], row[key as keyof PfmeaRow])) throw new Error('Procedure links and row metadata require a separate PFMEA command.');
    }
    if (row.verifiedAt !== prior.verifiedAt && row.verifiedAt !== undefined) throw new Error('Verification requires a separate PFMEA command.');
    for (const field of PFMEA_EDITABLE_CELL_FIELDS) {
      const previous = prior[field] ?? null; const value = row[field] ?? null;
      if (samePfmeaValue(previous, value)) continue;
      if (field === 'actionStatus' && value === 'closed') throw new Error('Verification requires a separate PFMEA command.');
      changes.push({ rowId: row.id, field, expectedVersion: versions[row.id]?.[field]?.version ?? 0, previous, value });
    }
  }
  return changes;
}
