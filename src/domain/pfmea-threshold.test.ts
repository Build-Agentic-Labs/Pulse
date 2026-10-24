import { describe, it, expect } from 'vitest';
import type { Task } from './types';
import { emptyPlannerState } from './empty-planner-state';
import { createPfmeaDocumentFromProcedure, getPfmeaRowIssues, isHighPriorityPfmeaRow, getProductPfmeaDocument, PRODUCT_PFMEA_DOCUMENT_FIELD, serializePfmeaDocument, pfmeaAssessmentState } from './pfmea';
import { closePfmeaAction, pfmeaClosureIssues } from './pfmea-workflow';
const task = {id:'threshold-task',name:'Threshold fixture',wbs:'1',rowType:'task'} as Task;
function fixture() {
 const doc = createPfmeaDocumentFromProcedure(emptyPlannerState.product,emptyPlannerState.scenario,[task],[]);
 Object.assign(doc.rows[0],{failureMode:'Loose part',effect:'Damage',cause:'Vibration',currentControls:'Torque',detectionActivity:'Inspection',severity:5,occurrence:4,detection:5});
 return doc;
}
describe('PFMEA configurable threshold',()=>{
 it('requires action at equality, leaves below-threshold action fields optional',()=>{
  const doc=fixture(); doc.settings.highRpnThreshold=101;
  expect(getPfmeaRowIssues(doc.rows[0],doc.settings)).toEqual([]);
  expect(pfmeaAssessmentState(doc.rows[0],doc.settings)).toBe('complete');
  doc.settings.highRpnThreshold=100;
  expect(isHighPriorityPfmeaRow(doc.rows[0],doc.settings)).toBe(true);
  expect(pfmeaAssessmentState(doc.rows[0],doc.settings)).toBe('in_progress');
  expect(getPfmeaRowIssues(doc.rows[0],doc.settings).some(i=>i.field==='recommendedActions')).toBe(true);
 });
 it('requires final RPN strictly below threshold before verification',()=>{
  const doc=fixture();doc.settings.highRpnThreshold=100;
  Object.assign(doc.rows[0],{recommendedActions:'Add check',actionOwner:'Tester',targetDate:'2026-10-23',actionsTaken:'Check installed',verificationNotes:'Trial passed',resultOccurrence:4,resultDetection:5});
  expect(pfmeaClosureIssues(doc.rows[0],doc.settings)).toContain('Final RPN must be below the threshold.');
  expect(()=>closePfmeaAction(doc.rows[0],true,new Date(),doc.settings)).toThrow('threshold');
  doc.rows[0].resultOccurrence=3;
  const closed=closePfmeaAction(doc.rows[0],true,new Date(),doc.settings);
  expect(pfmeaAssessmentState(closed,doc.settings)).toBe('complete');
 });
 it('preserves unset and existing thresholds without rewriting rows',()=>{
  const doc=fixture();const before=JSON.stringify(doc.rows);
  expect(doc.settings.highRpnThreshold).toBeNull();
  expect(isHighPriorityPfmeaRow(doc.rows[0],doc.settings)).toBe(false);
  doc.settings.highRpnThreshold=250;
  expect(getProductPfmeaDocument({[PRODUCT_PFMEA_DOCUMENT_FIELD]:serializePfmeaDocument(doc)})?.settings.highRpnThreshold).toBe(250);
  expect(JSON.stringify(doc.rows)).toBe(before);
 });
});
