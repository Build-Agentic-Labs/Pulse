import type { PfmeaDocument, PfmeaRow } from './pfmea';
import { parsePfmeaDelimitedText } from './pfmea-import';
import { patchPfmeaRow } from './pfmea-workflow';

export type PfmeaPasteTarget = { rowId: string; field: string; options?: { value: string; label: string }[] };
const textFields = new Set(['failureMode', 'effect', 'cause', 'currentControls', 'detectionActivity', 'recommendedActions', 'actionsTaken', 'verificationNotes']);
const scores = new Set(['severity', 'occurrence', 'detection', 'resultOccurrence', 'resultDetection']);

/** Validate the complete block before creating a single document/history update. */
export function pastePfmeaGrid(document: PfmeaDocument, text: string, targets: PfmeaPasteTarget[][]): PfmeaDocument {
  const values = parsePfmeaDelimitedText(text, '\t').map(row => row.map(value => String(value ?? '')));
  if (!values.length || values.some(row => row.length !== values[0].length)) throw new Error('Paste a rectangular block of cells.');
  const patches = new Map<string, Partial<PfmeaRow>>();
  for (const [r, row] of values.entries()) for (const [c, value] of row.entries()) {
    const target = targets[r]?.[c];
    if (!target || !document.rows.some(item => item.id === target.rowId)) throw new Error('The pasted block does not fit the visible editable cells.');
    const { field } = target;
    const patch = patches.get(target.rowId) ?? {};
    if (textFields.has(field)) Object.assign(patch, { [field]: value });
    else if (scores.has(field)) {
      if (value.trim() && !/^(?:[1-9]|10)$/.test(value.trim())) throw new Error('Scores must be whole numbers from 1 to 10. Nothing was pasted.');
      Object.assign(patch, { [field]: value.trim() ? Number(value) : undefined });
    } else if (field === 'targetDate') {
      if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error('Use YYYY-MM-DD for pasted dates. Nothing was pasted.');
      patch.targetDate = value || undefined;
    } else if (target.options && (field === 'actionOwnerId' || field === 'actionStatus')) {
      const matches = target.options.filter(option => option.value === value || option.label.toLowerCase() === value.toLowerCase());
      if (matches.length !== 1 || matches[0].value === 'legacy') throw new Error('Choose an unambiguous existing owner or action status. Nothing was pasted.');
      if (field === 'actionOwnerId') { patch.actionOwnerId = matches[0].value || undefined; patch.actionOwner = matches[0].value ? matches[0].label : ''; }
      else { patch.actionStatus = matches[0].value as PfmeaRow['actionStatus']; patch.verifiedAt = undefined; }
    } else throw new Error('This cell cannot be pasted into. Nothing was pasted.');
    patches.set(target.rowId, patch);
  }
  return { ...document, rows: document.rows.map(row => patches.has(row.id) ? patchPfmeaRow(row, patches.get(row.id)!) : row) };
}
