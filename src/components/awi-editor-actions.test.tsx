// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AwiEditorActions } from "./awi-editor-actions";
import { updateAwiMetadata, type AwiMaster } from "@/lib/awi/store";
vi.mock("@/lib/awi/store", () => ({ updateAwiMetadata: vi.fn() }));
vi.mock("./work-instruction/work-instruction-print", () => ({ WorkInstructionPrintPreview: () => null }));
const master = {document_number:"AWI-TEST",category:"Accessory",project_id:"fixture",task_id:"fixture"} as AwiMaster;
beforeEach(() => {
 vi.clearAllMocks();
 Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:function(this:HTMLDialogElement){this.open=true}});
 Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:function(this:HTMLDialogElement){this.open=false}});
});
function open(beforeSave:()=>Promise<boolean> = async()=>false) {
 render(<AwiEditorActions master={master} saveState="saved" readOnly={false} ready beforeSave={beforeSave}/>);
 const trigger=screen.getByRole("button",{name:"AWI details"}); trigger.focus(); fireEvent.click(trigger); return trigger;
}
it("focuses the number and restores the opener after cancellation",()=>{
 const trigger=open(); expect(screen.getByLabelText("AWI number")).toHaveFocus();
 fireEvent(screen.getByRole("dialog",{name:"AWI details"}),new Event("cancel",{cancelable:true}));
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
 expect(updateAwiMetadata).not.toHaveBeenCalled();
});
it("keeps the dialog open and prevents metadata writes when procedure saving fails",async()=>{
 open(); await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Save"}))});
 expect(screen.getByRole("alert")).toHaveTextContent("Save the procedure changes");
 expect(updateAwiMetadata).not.toHaveBeenCalled(); expect(screen.getByRole("dialog")).toBeInTheDocument();
});
it("locks cancellation and duplicate submission while save prerequisites are pending",async()=>{
 let finish!:(result:boolean)=>void;const before=vi.fn(()=>new Promise<boolean>(resolve=>{finish=resolve}));open(before);
 fireEvent.click(screen.getByRole("button",{name:"Save"}));
 expect(screen.getByRole("button",{name:"Cancel"})).toBeDisabled();
 expect(screen.getByRole("button",{name:"Close AWI details"})).toBeDisabled();
 expect(screen.getByLabelText("AWI number")).toBeDisabled();
 fireEvent(screen.getByRole("dialog"),new Event("cancel",{cancelable:true}));
 expect(screen.getByRole("dialog")).toBeInTheDocument();
 fireEvent.submit(screen.getByRole("button",{name:"Saving…"}).closest("form")!);
 expect(before).toHaveBeenCalledOnce();
 await act(async()=>finish(false));expect(screen.getByRole("button",{name:"Cancel"})).toBeEnabled();
});
it("preserves edited values and allows recovery from metadata errors",async()=>{
 vi.mocked(updateAwiMetadata).mockRejectedValueOnce(new Error("Save unavailable"));open(async()=>true);
 fireEvent.change(screen.getByLabelText("AWI number"),{target:{value:"AWI-UPDATED"}});
 fireEvent.change(screen.getByLabelText("Category"),{target:{value:"Trailer"}});
 await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Save"}))});
 expect(updateAwiMetadata).toHaveBeenCalledWith(master,"AWI-UPDATED","Trailer");
 expect(screen.getByRole("alert")).toHaveTextContent("Save unavailable");
 expect(screen.getByLabelText("AWI number")).toHaveValue("AWI-UPDATED");
 expect(screen.getByRole("button",{name:"Save"})).toBeEnabled();
});
