import { describe, it, expect } from 'vitest';
import { emptyPlannerState } from './empty-planner-state';
import { createPfmeaDocumentFromProcedure, getProductPfmeaDocument, PRODUCT_PFMEA_DOCUMENT_FIELD, serializePfmeaDocument } from './pfmea';
import { pfmeaLinkIssue, previewPfmeaSync, relinkPfmeaRow } from './pfmea-workflow';
import type { Task } from './types';
const source = { id: 'task', name: 'Task', wbs: '1', rowType: 'task', manufacturingSteps: [{ id: 'old', sequence: 1, name: 'Old step', instruction: '' }] } as Task;
function fixture() { return createPfmeaDocumentFromProcedure(emptyPlannerState.product, emptyPlannerState.scenario, [source], []); }
describe('PFMEA source review', () => {
  it('previews added, changed and missing links without changing the original analysis', () => {
    const doc = fixture(); doc.rows[0].failureMode = 'Risk to preserve';
    const before = structuredClone(doc);
    const replacement = { ...source, manufacturingSteps: [{ id: 'new', sequence: 1, name: 'New step', instruction: '' }] };
    const preview = previewPfmeaSync(doc, emptyPlannerState.scenario, [replacement], []);
    expect(preview.added).toHaveLength(1); expect(preview.missing).toHaveLength(1);
    expect(preview.next.rows[0].failureMode).toBe('Risk to preserve'); expect(doc).toEqual(before);
    const renamed = previewPfmeaSync(doc, emptyPlannerState.scenario, [{ ...source, name: 'Renamed' }], []);
    expect(renamed.changed).toHaveLength(1);
  });
  it('relinks without losing analysis and retains the original source history', () => {
    const row = { ...fixture().rows[0], failureMode: 'Risk', severity: 8 };
    const next = relinkPfmeaRow(row, source, undefined, []);
    expect(next).toMatchObject({ id: row.id, failureMode: 'Risk', severity: 8 });
    expect(next.linkHistory?.[0].stepId).toBe('old');
    expect(row.stepId).toBe('old'); expect(next.stepId).toBeUndefined();
    expect(() => relinkPfmeaRow(row, source, 'missing', [])).toThrow();
    expect(pfmeaLinkIssue(row, [])).toBe('Source task missing');
  });
  it('preserves archived analysis through parsing and sync without recreating it', () => {
    const doc = fixture(); doc.rows[0].archivedAt = '2026-10-23T12:00:00Z';
    doc.rows[0].failureMode = 'Archived risk';
    const parsed = getProductPfmeaDocument({ [PRODUCT_PFMEA_DOCUMENT_FIELD]: serializePfmeaDocument(doc) })!;
    const next = previewPfmeaSync(parsed, emptyPlannerState.scenario, [source], []).next;
    expect(next.rows).toHaveLength(1); expect(next.rows[0]).toEqual(parsed.rows[0]);
    expect(pfmeaLinkIssue(next.rows[0], [])).toBeUndefined();
  });
});

it('requires evidence and verification to close, and reopens after substantive edits', async () => {
  const { closePfmeaAction, patchPfmeaRow, isPfmeaActionOverdue } = await import('./pfmea-workflow');
  const row = { ...fixture().rows[0], failureMode:'Loose', effect:'Leak', severity:6, cause:'Missed torque', occurrence:3, currentControls:'Torque standard', detection:2, detectionActivity:'Leak test', recommendedActions:'Add check', actionOwner:'Owner', targetDate:'2026-10-22', actionsTaken:'Check implemented', resultOccurrence:2, resultDetection:1, verificationNotes:'Test run passed' };
  expect(isPfmeaActionOverdue(row, '2026-10-23')).toBe(true);
  expect(isPfmeaActionOverdue(row, '2026-10-22')).toBe(false);
  expect(() => closePfmeaAction(row, false)).toThrow();
  expect(() => closePfmeaAction({ ...row, verificationNotes:'' }, true)).toThrow();
  const closed = closePfmeaAction(row, true);
  expect(isPfmeaActionOverdue(closed, '2026-10-23')).toBe(false);
  const reopened = patchPfmeaRow(closed, { cause:'Different cause' });
  expect(reopened.actionStatus).toBe('awaiting_verification'); expect(reopened.verifiedAt).toBeUndefined();
  expect(patchPfmeaRow(closed, { archivedAt:'2026-10-23' }).verifiedAt).toBe(closed.verifiedAt);
  const doc = fixture(); doc.rows = [closed];
  expect(getProductPfmeaDocument({[PRODUCT_PFMEA_DOCUMENT_FIELD]:serializePfmeaDocument(doc)})?.rows[0]).toMatchObject({ actionStatus:'closed', verificationNotes:'Test run passed', verifiedAt:closed.verifiedAt });
});
