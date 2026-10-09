// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ModalSurface } from "./modal-surface";
import { ThemedSelect } from "../themed-select";
it("keeps a select's Escape local, including when search has no matches",()=>{
 const cancel=vi.fn();render(<ModalSurface label="Outer" onCancel={cancel}><ThemedSelect searchable ariaLabel="Choice" value="" onChange={vi.fn()} options={[{value:"one",label:"One"}]}/></ModalSurface>);
 fireEvent.click(screen.getByRole("button",{name:"Choice"}));
 const search=screen.getByRole("textbox");fireEvent.change(search,{target:{value:"missing"}});
 fireEvent.keyDown(search,{key:"Escape"});
 expect(screen.queryByRole("listbox")).not.toBeInTheDocument();expect(cancel).not.toHaveBeenCalled();
 expect(screen.getByRole("button",{name:"Choice"})).toHaveFocus();
});
it("wraps both directions and shields an outer keyboard handler",()=>{
 const outside=vi.fn();render(<div onKeyDown={outside}><ModalSurface label="Controls" onCancel={vi.fn()}><button>First</button><button>Last</button></ModalSurface></div>);
 const first=screen.getByRole("button",{name:"First"}),last=screen.getByRole("button",{name:"Last"});
 for(const node of [first,last])vi.spyOn(node,"getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
 last.focus();fireEvent.keyDown(last,{key:"Tab"});expect(first).toHaveFocus();
 fireEvent.keyDown(first,{key:"Tab",shiftKey:true});expect(last).toHaveFocus();expect(outside).not.toHaveBeenCalled();
});
it("suspends its modal layer without discarding form state",()=>{
 const view=render(<ModalSurface active label="Retained" onCancel={vi.fn()}><input aria-label="Draft" defaultValue="original"/></ModalSurface>);
 fireEvent.change(screen.getByLabelText("Draft"),{target:{value:"edited"}});
 view.rerender(<ModalSurface active={false} label="Retained" onCancel={vi.fn()}><input aria-label="Draft" defaultValue="original"/></ModalSurface>);
 expect(document.querySelector("dialog")?.open).toBe(false);
 view.rerender(<ModalSurface active label="Retained" onCancel={vi.fn()}><input aria-label="Draft" defaultValue="original"/></ModalSurface>);
 expect(screen.getByLabelText("Draft")).toHaveValue("edited");expect(screen.getByRole("dialog")).toBeInTheDocument();
});
it("leaves embedded content in place without a modal layer",()=>{
 const view=render(<ModalSurface modal={false} label="Embedded" onCancel={vi.fn()}><p>Inline preview</p></ModalSurface>);
 expect(view.container).toHaveTextContent("Inline preview");expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("includes native media controls in the keyboard boundary", () => {
  render(<ModalSurface label="Media" onCancel={vi.fn()}><button>Close media</button><video controls aria-label="Playback" /></ModalSurface>);
  const close = screen.getByRole("button", { name: "Close media" });
  const media = screen.getByLabelText("Playback");
  for (const node of [close, media]) vi.spyOn(node, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  const focus = vi.spyOn(media, "focus");
  close.focus();
  fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  expect(focus).toHaveBeenCalled();
});
