import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StepPhotoAttachmentEditor } from "./step-editors";
import { StepPhotoClipboardProvider, useStepPhotoClipboard } from "./step-photo-clipboard-provider";
import type { ManufacturingStep } from "@/domain/types";
const photo={id:"photo-source",name:"Source",dataUrl:"https://example.test/photo",capturedAt:"2026-09-05"};
const step={id:"destination",sequence:3} as ManufacturingStep;
function Source(){const clipboard=useStepPhotoClipboard();return <button onClick={()=>{clipboard.putOnClipboard(photo,"task","source","copy");clipboard.setActiveStep({taskId:"task",stepId:"wrong-hover"});}}>Copy source</button>;}
function setup(paste=vi.fn().mockResolvedValue(undefined)) {
 const files=vi.fn();
 const view=render(<StepPhotoClipboardProvider onPaste={paste}><Source/><StepPhotoAttachmentEditor taskId="task" step={step} photos={[]} onFilesSelected={files} onRequestRemove={vi.fn()}/></StepPhotoClipboardProvider>);
 return {...view,files,paste};
}
afterEach(()=>vi.restoreAllMocks());
describe("photo paste controls",()=>{
 it("pastes into the explicit destination even when another step is hovered",async()=>{
  const {paste}=setup();fireEvent.click(screen.getByText("Copy source"));
  fireEvent.paste(screen.getByRole("region"),{clipboardData:{items:[],files:[]}});
  await waitFor(()=>expect(paste).toHaveBeenCalledTimes(1));
  expect(paste).toHaveBeenCalledWith(expect.objectContaining({photo}),{taskId:"task",stepId:"destination"});
 });
 it("gives native image bytes priority over an older copied app photo",()=>{
  const {paste,files}=setup();fireEvent.click(screen.getByText("Copy source"));
  const image=new File(["image"],"screenshot.png",{type:"image/png"});
  fireEvent.paste(screen.getByRole("region"),{clipboardData:{items:[],files:[image]}});
  expect(files).toHaveBeenCalledWith([image]);expect(paste).not.toHaveBeenCalled();
 });
 it("disables duplicate paste while a copy is being saved",async()=>{
  let finish!:()=>void;const paste=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));setup(paste);
  fireEvent.click(screen.getByText("Copy source"));const button=screen.getByRole("button",{name:"Paste photo into step 3"});
  fireEvent.click(button);fireEvent.click(button);
  expect(paste).toHaveBeenCalledTimes(1);expect(button).toBeDisabled();
  await act(async()=>finish());await waitFor(()=>expect(button).not.toBeDisabled());
  expect(screen.getByText("Photo pasted into Step 3.")).toBeInTheDocument();
 });
 it("provides keyboard fallback when clipboard access is blocked",async()=>{
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{read:vi.fn().mockRejectedValue(new Error("denied"))}});
  const {files}=setup();fireEvent.click(screen.getByRole("button",{name:"Paste photo into step 3"}));
  expect(await screen.findByText("Press Cmd/Ctrl+V in this photo area to paste, or use Upload.")).toBeInTheDocument();
  expect(files).not.toHaveBeenCalled();expect(screen.getByRole("region")).toHaveFocus();
 });
 it("reads a system clipboard image from the explicit button",async()=>{
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{read:vi.fn().mockResolvedValue([{types:["image/png"],getType:vi.fn().mockResolvedValue(new Blob(["image"],{type:"image/png"}))}])}});
  const {files}=setup();fireEvent.click(screen.getByRole("button",{name:"Paste photo into step 3"}));
  await waitFor(()=>expect(files).toHaveBeenCalledTimes(1));expect(files.mock.calls[0][0][0].type).toBe("image/png");
 });
});
