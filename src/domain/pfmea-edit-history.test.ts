import { describe,it,expect } from 'vitest';
import { createPfmeaEditHistory } from './pfmea-edit-history';
import { createPfmeaDocumentFromProcedure } from './pfmea';
import { emptyPlannerState } from './empty-planner-state';
const base = createPfmeaDocumentFromProcedure(emptyPlannerState.product,emptyPlannerState.scenario,[],[]);
const doc = (item:string) => ({...base,item});
describe('PFMEA edit history',()=>{
 it('coalesces a whole cell edit and redoes its final value',()=>{
  const h=createPfmeaEditHistory(); const a=doc(''),b=doc('T'),c=doc('Text');
  h.record(a,b,'cell');h.record(b,c,'cell');expect(h.undo()).toBe(a);expect(h.redo()).toBe(c);
 });
 it('keeps different cells as separate steps and clears redo after a new edit',()=>{
  const h=createPfmeaEditHistory(); const a=doc('a'),b=doc('b'),c=doc('c'),d=doc('d');
  h.record(a,b,'one');h.record(b,c,'two');expect(h.undo()).toBe(b);h.record(b,d,'three');expect(h.redo()).toBeUndefined();expect(h.undo()).toBe(b);expect(h.undo()).toBe(a);
 });
 it('cancels the active edit without adding an undo of cancellation',()=>{
  const h=createPfmeaEditHistory();const a=doc('a'),b=doc('b'),c=doc('c');h.record(a,b,'one');h.record(b,c,'two');expect(h.cancel('two')).toBe(b);expect(h.undo()).toBe(a);
 });
 it('bounds history and resets across documents',()=>{
  const h=createPfmeaEditHistory(2);const a=doc('a'),b=doc('b'),c=doc('c'),d=doc('d');h.record(a,b);h.record(b,c);h.record(c,d);h.undo();h.undo();expect(h.undo()).toBeUndefined();h.clear();expect(h.status()).toEqual({undo:false,redo:false});
 });
});
