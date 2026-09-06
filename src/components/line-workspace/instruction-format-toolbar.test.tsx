import {useState} from "react";
import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {describe,it,expect} from "vitest";
import {InstructionFormatToolbar} from "./instruction-format-toolbar";
import {handleInstructionBulletKeyDown} from "./shared";
function Editor(){const [value,setValue]=useState('Intro\nFirst\nSecond');return <div data-instruction-step="test"><InstructionFormatToolbar sequence={1} value={value} onChange={setValue}/><textarea aria-label="Step 1 instruction" value={value} onChange={e=>setValue(e.target.value)} onKeyDown={e=>handleInstructionBulletKeyDown(e,setValue)}/></div>;}
describe("instruction toolbar",()=>{
 it("formats selected lines and restores the caret for continued typing",async()=>{
  render(<Editor/>);const input=screen.getByRole('textbox') as HTMLTextAreaElement;
  input.focus();input.setSelectionRange(6,18);fireEvent.click(screen.getByRole('button',{name:'Format step 1 as steps'}));
  await waitFor(()=>expect(input).toHaveFocus());
  await waitFor(()=>expect(input.selectionStart).toBe(input.value.length));
  expect(input.value).toBe('Intro\nA. First\nB. Second');
  fireEvent.keyDown(input,{key:'Enter'});
  await waitFor(()=>expect(input.selectionStart).toBe(input.value.length));
  expect(input.value).toBe('Intro\nA. First\nB. Second\nC. ');
 });
});
