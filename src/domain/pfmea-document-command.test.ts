import { describe, expect, it } from 'vitest';
import { buildPfmeaDocumentCommand } from './pfmea-document-command';
import { createPfmeaDocumentFromProcedure, createPfmeaRowForProcedureLink } from './pfmea';
import { emptyPlannerState } from './empty-planner-state';
import type { Task } from './types';
function fixture() { const doc = createPfmeaDocumentFromProcedure(emptyPlannerState.product,emptyPlannerState.scenario,[],[]); doc.rows=[createPfmeaRowForProcedureLink({id:'t',name:'Fixture',wbs:'1',customFields:{}} as Task,undefined,undefined)]; return doc; }
describe('PFMEA document commands',()=>{
 it('preserves another editor’s cell while changing settings and adding a row',()=>{ const base=fixture(),edited=structuredClone(base),remote=structuredClone(base); edited.settings.highRpnThreshold=125; edited.rows.push({...structuredClone(base.rows[0]),id:'new'}); remote.rows[0].effect='Other editor'; const next=buildPfmeaDocumentCommand(base,edited,remote); expect(next.rows[0].effect).toBe('Other editor'); expect(next.rows).toHaveLength(2); expect(next.settings.highRpnThreshold).toBe(125); });
 it('rejects same-cell conflicts rather than replacing newer values',()=>{const base=fixture(),edited=structuredClone(base),remote=structuredClone(base); edited.rows[0].effect='Mine'; remote.rows[0].effect='Theirs'; expect(()=>buildPfmeaDocumentCommand(base,edited,remote)).toThrow('conflict');});
 it('preserves rows another editor added',()=>{const base=fixture(),edited=structuredClone(base),remote=structuredClone(base); edited.owner='Owner'; remote.rows.push({...structuredClone(base.rows[0]),id:'other'}); expect(buildPfmeaDocumentCommand(base,edited,remote).rows).toHaveLength(2);});
});
