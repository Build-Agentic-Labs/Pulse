import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { StepPhotoAttachment } from "@/domain/step-photos";
import { acknowledgeAnnotationDrafts, readAnnotationDraft, writeAnnotationDraft } from "@/lib/photo-annotation-drafts";
import { StepPhotoViewer } from "./step-photo-viewer";

const photos: StepPhotoAttachment[] = [1, 2, 3].map((number) => ({
  id: `photo-${number}`,
  name: `Photo ${number}.png`,
  dataUrl: "data:image/png;base64,iVBORw0KGgo=",
  capturedAt: "2026-08-05T00:00:00.000Z",
  contentType: "image/png",
  width: 800,
  height: 600,
}));

let notifyResizeObserver: (() => void) | undefined;

beforeAll(() => {
  class ResizeObserverMock {
    constructor(callback: ResizeObserverCallback) {
      notifyResizeObserver = () => callback([], this as unknown as ResizeObserver);
    }
    observe() {}
    disconnect() {}
  }

  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

function prepareOverlay(container: HTMLElement) {
  const overlay = container.querySelector<HTMLElement>(".ui-photo-viewer-annotation-layer");
  expect(overlay).not.toBeNull();

  Object.defineProperties(overlay!, {
    clientWidth: { value: 800 },
    clientHeight: { value: 600 },
    setPointerCapture: { value: vi.fn() },
    releasePointerCapture: { value: vi.fn() },
    hasPointerCapture: { value: vi.fn(() => true) },
    getBoundingClientRect: {
      value: () => ({
        bottom: 600,
        height: 600,
        left: 0,
        right: 800,
        top: 0,
        width: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    },
  });

  act(() => notifyResizeObserver?.());

  return overlay!;
}

function expandToolbar() {
  fireEvent.click(screen.getByRole("button", { name: "Expand photo toolbar" }));
}


const arrow = {id:"a",type:"arrow" as const,color:"#d71921",strokeWidth:3,x1:0.1,y1:0.1,x2:0.5,y2:0.5};
const marked = {...photos[0], annotations:{version:2 as const,items:[arrow]}};
function props(photo=marked) {return {stepSequence:2,photo,photos:[photo,photos[1]],onClose:vi.fn(),onPhotoChange:vi.fn(),onUpdatePhoto:vi.fn()};}
describe("Annotation lifecycle audit",()=>{
 it("flushes edits to the correct photo when switching before debounce",()=>{
  const p=props(); const {container,rerender}=render(<StepPhotoViewer {...p}/>); prepareOverlay(container); expandToolbar();
  const target=container.querySelector(".ui-photo-annotation-item line[stroke='transparent']")!;
  fireEvent.pointerDown(target,{clientX:80,clientY:60,pointerId:1});
  fireEvent.click(screen.getByRole("button",{name:"Increase annotation size"}));
  rerender(<StepPhotoViewer {...p} photo={photos[1]}/>);
  expect(p.onUpdatePhoto).toHaveBeenCalledWith(marked.id,expect.objectContaining({annotations:expect.objectContaining({items:[expect.objectContaining({id:"a"})]})}));
  expect(container.querySelectorAll(".ui-photo-annotation-item")).toHaveLength(0);
 });
 it("accepts incoming annotations on an unedited open photo",()=>{
  const p=props();const {container,rerender}=render(<StepPhotoViewer {...p}/>);prepareOverlay(container);
  expect(container.querySelectorAll(".ui-photo-annotation-item")).toHaveLength(1);
  rerender(<StepPhotoViewer {...p} photo={{...marked,annotations:{version:2,items:[]}}}/>);
  expect(container.querySelectorAll(".ui-photo-annotation-item")).toHaveLength(0);
 });
 it("flushes pending annotations on pagehide",()=>{
  const p=props();const {container,unmount}=render(<StepPhotoViewer {...p}/>);const overlay=prepareOverlay(container);expandToolbar();
  fireEvent.click(screen.getByRole("button",{name:"Draw rectangle"}));
  fireEvent.pointerDown(overlay,{clientX:100,clientY:100,pointerId:1});fireEvent.pointerMove(overlay,{clientX:300,clientY:200,pointerId:1});fireEvent.pointerUp(overlay,{clientX:300,clientY:200,pointerId:1});
  fireEvent(window,new Event("pagehide"));
  expect(p.onUpdatePhoto).toHaveBeenCalledTimes(1);
  unmount();expect(p.onUpdatePhoto).toHaveBeenCalledTimes(1);
 });
 it("updates selected annotation color and stroke size",()=>{
  const p=props();const {container,unmount}=render(<StepPhotoViewer {...p}/>);prepareOverlay(container);expandToolbar();
  fireEvent.pointerDown(container.querySelector(".ui-photo-annotation-item line[stroke='transparent']")!,{clientX:80,clientY:60,pointerId:1});
  fireEvent.click(screen.getByRole("button",{name:"Increase annotation size"}));
  fireEvent.click(screen.getByRole("button",{name:"Annotation color"}));
  fireEvent.click(screen.getByRole("option",{name:"Blue"}));
  unmount();const saved=p.onUpdatePhoto.mock.calls.at(-1)?.[1].annotations.items[0];
  expect(saved.color).not.toBe(arrow.color);expect(saved.strokeWidth).toBeGreaterThan(arrow.strokeWidth);
 });
});


describe("durable annotation drafts", () => {
 it("restores a draft after remount and resubmits it", () => {
  const taskId="restore-test";
  writeAnnotationDraft(taskId,photos[0].id,{version:2,items:[]},marked.annotations);
  const p={...props(),taskId,photo:photos[0]};
  const {container}=render(<StepPhotoViewer {...p}/>);prepareOverlay(container);
  expect(container.querySelectorAll(".ui-photo-annotation-item")).toHaveLength(1);
  expect(p.onUpdatePhoto).toHaveBeenCalledWith(photos[0].id,expect.objectContaining({annotations:marked.annotations}));
  expect(readAnnotationDraft(taskId,photos[0].id)).toBeDefined();
  acknowledgeAnnotationDrafts(taskId,{[photos[0].id]:marked.annotations});
  expect(readAnnotationDraft(taskId,photos[0].id)).toBeUndefined();
 });
 it("retains newer edits when an older save completes",()=>{
  const taskId="newer-test";
  writeAnnotationDraft(taskId,photos[0].id,{version:2,items:[]},{version:2,items:[{...arrow,color:"blue"}]});
  acknowledgeAnnotationDrafts(taskId,{[photos[0].id]:marked.annotations});
  expect(readAnnotationDraft(taskId,photos[0].id)?.local.items[0].color).toBe("blue");
  acknowledgeAnnotationDrafts(taskId,{[photos[0].id]:{version:2,items:[{...arrow,color:"blue"},{...arrow,id:"remote"}]}});
  expect(readAnnotationDraft(taskId,photos[0].id)).toBeUndefined();
 });
});

describe("Annotation export audit",()=>{
 it("renders annotations into the download using mocked canvas and image APIs",async()=>{
  const ctx=new Proxy({}, {get:(_target,key)=> key==="measureText" ? () => ({width:30}) : vi.fn()});
  const getContext=vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue(ctx as CanvasRenderingContext2D);
  const encode=vi.spyOn(HTMLCanvasElement.prototype,"toBlob").mockImplementation(cb=>cb(new Blob(["test"],{type:"image/png"})));
  const click=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
  vi.stubGlobal("Image",class {naturalWidth=800;naturalHeight=600;onload?:()=>void;set src(_v:string){queueMicrotask(()=>this.onload?.());}});
  const create=vi.fn(()=>"blob:annotation-test");vi.stubGlobal("URL",Object.assign(class extends URL {},{createObjectURL:create,revokeObjectURL:vi.fn()}));
  try {
   const p=props();const {container}=render(<StepPhotoViewer {...p}/>);prepareOverlay(container);expandToolbar();
   fireEvent.click(screen.getByRole("button",{name:"Download photo"}));
   await waitFor(()=>expect(click).toHaveBeenCalledTimes(1));
   expect(getContext).toHaveBeenCalled();expect(encode).toHaveBeenCalled();expect(create).toHaveBeenCalled();
   expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  } finally {getContext.mockRestore();encode.mockRestore();click.mockRestore();vi.unstubAllGlobals();}
 });
});
