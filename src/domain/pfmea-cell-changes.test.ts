import { describe, expect, it } from 'vitest';
import { buildPfmeaCellChanges } from './pfmea-cell-changes';
import { createPfmeaDocumentFromProcedure, createPfmeaRowForProcedureLink } from './pfmea';
import type { Task } from './types';
const task = { id: 'task', name: 'Fixture', wbs: '1', customFields: {} } as Task;
import { emptyPlannerState } from './empty-planner-state';
function fixture() { const document = createPfmeaDocumentFromProcedure(emptyPlannerState.product, emptyPlannerState.scenario, [], []); document.rows = [createPfmeaRowForProcedureLink(task, undefined, undefined)]; return document; }
describe('PFMEA cell edit contract', () => {
  it('sends only changed cells with the version and previous value', () => {
    const base = fixture(); const edited = structuredClone(base); edited.rows[0].severity = 7;
    expect(buildPfmeaCellChanges(base, edited, { [base.rows[0].id]: { severity: { version: 3, mutationId: 'old' } } })).toEqual([{ rowId:base.rows[0].id, field:'severity', expectedVersion:3, previous:null, value:7 }]);
  });
  it('uses IDs rather than row positions or timestamps', () => {
    const base = fixture(); base.rows.push(createPfmeaRowForProcedureLink(task,undefined,undefined));
    const edited=structuredClone(base); edited.rows.reverse(); edited.updatedAt='later'; edited.rows[0].updatedAt='later';
    expect(buildPfmeaCellChanges(base,edited)).toEqual([]);
  });
  it('does not permit verification through an ordinary cell patch', () => {
    const base=fixture(); const edited=structuredClone(base); edited.rows[0].actionStatus='closed';
    expect(()=>buildPfmeaCellChanges(base,edited)).toThrow('Verification');
  });
  it('requires separate commands for structural or scope changes', () => {
    const base=fixture(); const edited=structuredClone(base); edited.rows=[];
    expect(()=>buildPfmeaCellChanges(base,edited)).toThrow('separate');
    expect(()=>buildPfmeaCellChanges(base,{...base,id:'other'})).toThrow('scope');
  });
});
