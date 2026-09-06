import {describe,it,expect} from "vitest";
import {formatInstruction,resolveBulletEnter,instructionBlocks} from "./instruction-bullets";
describe("structured instruction editing",()=>{
 it.each([['- One','- '],['* One','* '],['• One','• '],['A. One','B. '],['Z. One','AA. '],['1. One','2. ']])("continues %s",(value,prefix)=>{
  expect(resolveBulletEnter(value,value.length,value.length)?.value).toBe(`${value}\n${prefix}`);
 });
 it("preserves a paragraph break when ending an empty list item",()=>{
  expect(resolveBulletEnter('A. One\nB. \nNext',10,10)).toEqual({value:'A. One\n\nNext',selectionStart:7});
 });
 it("does not duplicate a marker at the beginning of the line",()=>expect(resolveBulletEnter('- One',0,0)?.value).toBe('\n- One'));
 it("renumbers later items after splitting an item",()=>expect(resolveBulletEnter('A. One\nB. Two',6,6)?.value).toBe('A. One\nB. \nC. Two'));
 it("continues after a soft line break inside an item",()=>{
  const soft=resolveBulletEnter('A. One',6,6,true)!;
  expect(soft.value).toBe('A. One\n  ');
  const value=soft.value+'More';
  expect(resolveBulletEnter(value,value.length,value.length)?.value).toBe('A. One\n  More\nB. ');
  expect(instructionBlocks(value)).toHaveLength(1);
 });
 it("formats selected lines while leaving the introduction alone",()=>{
  expect(formatInstruction('Intro\nFirst\nSecond',6,18,'steps').value).toBe('Intro\nA. First\nB. Second');
 });
 it("converts existing markers without stacking them",()=>expect(formatInstruction('• First\n2. Second',0,17,'steps').value).toBe('A. First\nB. Second'));
 it("adds note/check labels without changing other lines",()=>expect(formatInstruction('Intro\nVerify label',6,6,'check').value).toBe('Intro\nCheck: Verify label'));
});
