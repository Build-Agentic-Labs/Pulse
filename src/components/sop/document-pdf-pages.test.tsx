// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DocumentPdfPages } from "./document-pdf-pages";
const engine = vi.hoisted(() => ({ getDocument: vi.fn(), GlobalWorkerOptions: {workerSrc: ""} }));
vi.mock("pdfjs-dist", () => engine);
const canvasContext = vi.fn();
const getPage = vi.fn();
const destroy = vi.fn();
const pdf = {numPages: 2, getPage};
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return {promise, resolve}; }
function bytes() { return {arrayBuffer: async () => new ArrayBuffer(8)} as Blob; }
beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(canvasContext.mockReturnValue({}));
  destroy.mockReset().mockResolvedValue(undefined);
  getPage.mockReset().mockResolvedValue({getViewport: () => ({width: 100, height: 150}), render: () => ({promise: Promise.resolve(), cancel: vi.fn()})});
  engine.getDocument.mockReset().mockReturnValue({promise: Promise.resolve(pdf), destroy});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it("shows progress through PDF parsing and canvas rendering, revealing images only after render completes", async () => {
  const parsed = deferred<typeof pdf>();
  const rendered = deferred<void>();
  engine.getDocument.mockReturnValue({promise: parsed.promise, destroy});
  getPage.mockResolvedValue({getViewport: () => ({width: 100, height: 150}), render: () => ({promise: rendered.promise, cancel: vi.fn()})});
  render(<DocumentPdfPages blob={bytes()} name="Photos" />);
  expect(screen.getByRole("status")).toHaveTextContent("Opening the document viewer");
  await act(async () => { parsed.resolve(pdf); });
  expect(screen.getAllByRole("status")[0]).toHaveTextContent("Rendering page 1");
  expect(screen.queryByRole("img")).toBeNull();
  await act(async () => { rendered.resolve(); });
  expect(screen.getByRole("img", {name: "Photos, page 1 of 2"})).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
});
it("offers retry when the PDF worker fails and then displays the document", async () => {
  engine.getDocument.mockReturnValueOnce({promise: Promise.reject(new Error("worker failed")), destroy});
  render(<DocumentPdfPages blob={bytes()} name="Photos" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not display this PDF");
  fireEvent.click(screen.getByRole("button", {name: "Retry document"}));
  expect(await screen.findByRole("img", {name: "Photos, page 1 of 2"})).toBeTruthy();
  expect(destroy).toHaveBeenCalled();
});
it("renders only nearby sheets for long documents", async () => {
  const callbacks: IntersectionObserverCallback[] = [];
  vi.stubGlobal("IntersectionObserver", class { constructor(callback: IntersectionObserverCallback) { callbacks.push(callback); } observe() {} disconnect() {} });
  render(<DocumentPdfPages blob={bytes()} name="Photos" />);
  await screen.findByRole("img", {name: "Photos, page 1 of 2"});
  expect(getPage).toHaveBeenCalledTimes(1);
  await act(async () => { callbacks[0]([{isIntersecting: true} as IntersectionObserverEntry], {} as IntersectionObserver); });
  expect(await screen.findByRole("img", {name: "Photos, page 2 of 2"})).toBeTruthy();
});
it("shows a retry instead of an endless loading state when the viewer stalls", async () => {
  vi.useFakeTimers();
  engine.getDocument.mockReturnValue({promise: new Promise(() => {}), destroy});
  render(<DocumentPdfPages blob={bytes()} name="Photos" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
  expect(screen.getByRole("alert")).toHaveTextContent("took too long");
  expect(screen.queryByRole("status")).toBeNull();
  expect(destroy).toHaveBeenCalled();
});
it("shows a page error and can retry a failed canvas render", async () => {
  const renderPage = vi.fn()
    .mockImplementationOnce(() => ({promise: Promise.reject(new Error("render failed")), cancel: vi.fn()}))
    .mockImplementation(() => ({promise: Promise.resolve(), cancel: vi.fn()}));
  getPage.mockResolvedValue({getViewport: () => ({width: 100, height: 150}), render: renderPage});
  engine.getDocument.mockReturnValue({promise: Promise.resolve({...pdf, numPages: 1}), destroy});
  render(<DocumentPdfPages blob={bytes()} name="Photos" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Page 1 could not be displayed");
  expect(screen.queryByRole("img")).toBeNull();
  fireEvent.click(screen.getByRole("button", {name: "Retry page 1"}));
  expect(await screen.findByRole("img", {name: "Photos, page 1 of 1"})).toBeTruthy();
});
