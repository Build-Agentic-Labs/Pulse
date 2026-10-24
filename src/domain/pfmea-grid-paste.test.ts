import { describe, it, expect } from 'vitest';
import type { Task } from './types';
import { emptyPlannerState } from './empty-planner-state';
import { createPfmeaDocumentFromProcedure, createPfmeaRowForProcedureLink } from './pfmea';
import { pastePfmeaGrid } from './pfmea-grid-paste';
import { createPfmeaEditHistory } from './pfmea-edit-history';
function fixture() {
  const doc = createPfmeaDocumentFromProcedure(emptyPlannerState.product, emptyPlannerState.scenario, [], []);
  doc.rows = [createPfmeaRowForProcedureLink({ id: "fixture", name: "Fixture" } as Task, undefined), createPfmeaRowForProcedureLink({ id: "fixture", name: "Fixture" } as Task, undefined)];
  return doc;
}
describe('PFMEA block paste', () => {
  it('applies a block atomically and undoes/redoes as one step', () => {
    const doc = fixture();
    const targets = doc.rows.map(row => ['failureMode', 'effect'].map(field => ({rowId: row.id, field})));
    const next = pastePfmeaGrid(doc, 'A\tB\r\nC\tD\r\n', targets);
    expect(next.rows.map(row => [row.failureMode, row.effect])).toEqual([['A','B'],['C','D']]);
    const history = createPfmeaEditHistory(); history.record(doc, next);
    expect(history.undo()).toBe(doc); expect(history.redo()).toBe(next);
    expect(doc.rows[0].failureMode).toBe('');
  });
  it('rejects invalid scores and overflow without mutating the document', () => {
    const doc = fixture(); const before = JSON.stringify(doc);
    expect(() => pastePfmeaGrid(doc,'Mode\t11',[[{rowId:doc.rows[0].id,field:'failureMode'},{rowId:doc.rows[0].id,field:'severity'}]])).toThrow('Scores');
    expect(() => pastePfmeaGrid(doc,'A\tB',[[{rowId:doc.rows[0].id,field:'failureMode'}]])).toThrow('fit');
    expect(JSON.stringify(doc)).toBe(before);
  });
  it('preserves quoted line breaks and blank cells', () => {
    const doc = fixture();
    const next = pastePfmeaGrid(doc,'"Line 1\nLine 2"\t',[[{rowId:doc.rows[0].id,field:'failureMode'},{rowId:doc.rows[0].id,field:'effect'}]]);
    expect(next.rows[0].failureMode).toBe('Line 1\nLine 2'); expect(next.rows[0].effect).toBe('');
  });
});
