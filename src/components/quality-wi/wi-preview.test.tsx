// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { QualityWi, WiRevision } from "@/domain/quality-wi/schema";
import { wiTemplateDocument } from "@/domain/quality-wi/schema";
import { WiPreview } from "./wi-preview";
import { listWiRevisions, signWiImages } from "@/lib/quality-wi/read-store";
import { buildQualityWiPdf } from "@/lib/quality-wi/export-pdf";
vi.mock("@/lib/quality-wi/read-store", () => ({ listWiRevisions: vi.fn(), signWiImages: vi.fn() }));
vi.mock("@/lib/quality-wi/export-pdf", () => ({ buildQualityWiPdf: vi.fn() }));
vi.mock("@/components/sop/document-pdf-pages", () => ({ DocumentPdfPages: () => <div>Rendered document</div> }));
vi.mock("@/components/themed-select", () => ({ ThemedSelect: ({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: {value: string; label: string}[] }) => <select aria-label="Preview version" value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }));
const document: QualityWi = { id: "wi", workspaceId: "w", departmentId: "d", departmentCode: "QAS", departmentName: "Quality", title: "Delivery photos", purpose: "Inspect delivery", responsibilities: "QA", documentNumber: null, version: 1, hasChanges: true, publishedRevisionId: null, updatedAt: "2026-10-08", steps: [{ id: "step", position: 1, title: "Take photo", instruction: "Capture plate", image: {id: "image", name: "plate", storagePath: "w/wi/plate.png", width: 100, height: 100, url: "expired"} }] };
const refreshed = { ...document, steps: document.steps.map(step => ({ ...step, image: { ...step.image!, url: "fresh" } })) };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.mocked(listWiRevisions).mockReset().mockResolvedValue([]);
  vi.mocked(signWiImages).mockReset().mockResolvedValue(refreshed);
  vi.mocked(buildQualityWiPdf).mockReset().mockResolvedValue(new Blob(["pdf"]));
  HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) { this.setAttribute("open", ""); });
  HTMLDialogElement.prototype.close = vi.fn(function(this: HTMLDialogElement) { this.removeAttribute("open"); });
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("shows progress and refreshes expired draft image links before building the PDF", async () => {
  const images = deferred<QualityWi>();
  vi.mocked(signWiImages).mockReturnValue(images.promise);
  render(<WiPreview document={document} onClose={() => {}} />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading WI preview");
  expect(screen.getByRole("button", {name: "PDF"})).toBeDisabled();
  expect(screen.getByRole("button", {name: "Word"})).toBeDisabled();
  await act(async () => { images.resolve(refreshed); });
  await screen.findByText("Rendered document");
  expect(signWiImages).toHaveBeenCalledWith(document);
  expect(buildQualityWiPdf).toHaveBeenCalledWith(expect.objectContaining({title: document.title}), refreshed.steps);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("button", {name: "PDF"})).toBeEnabled();
});
it("reports an unavailable published revision instead of loading forever or displaying the draft", async () => {
  render(<WiPreview document={{...document, publishedRevisionId: "missing"}} publishedOnly onClose={() => {}} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("published revision is unavailable");
  expect(screen.queryByRole("status")).toBeNull();
  expect(buildQualityWiPdf).not.toHaveBeenCalled();
  expect(screen.getByRole("button", {name: "Retry preview"})).toBeEnabled();
});
it("retries failed image access without reopening the dialog", async () => {
  vi.mocked(signWiImages).mockRejectedValueOnce(new Error("Image request failed"));
  render(<WiPreview document={document} onClose={() => {}} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Image request failed");
  fireEvent.click(screen.getByRole("button", {name: "Retry preview"}));
  await screen.findByText("Rendered document");
  expect(signWiImages).toHaveBeenCalledTimes(2);
});
it("ends a stalled load with a retry option and ignores its late result", async () => {
  vi.useFakeTimers();
  const images = deferred<QualityWi>();
  vi.mocked(signWiImages).mockReturnValue(images.promise);
  render(<WiPreview document={document} onClose={() => {}} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(screen.getByRole("alert")).toHaveTextContent("took too long");
  await act(async () => { images.resolve(refreshed); });
  expect(buildQualityWiPdf).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();
});
it("renders the selected published snapshot and its refreshed images", async () => {
  const released = {...document, title: "Published photos", publishedRevisionId: "release"};
  const revision: WiRevision = {id: "release", revisionIndex: 1, publishedAt: "2026-10-08", changeDescription: "Initial", steps: document.steps, snapshot: wiTemplateDocument(released, 1, "10/08/2026", "Initial")};
  vi.mocked(listWiRevisions).mockResolvedValue([revision]);
  render(<WiPreview document={released} publishedOnly onClose={() => {}} />);
  await screen.findByText("Rendered document");
  expect(buildQualityWiPdf).toHaveBeenCalledWith(expect.objectContaining({title: "Published photos", isDraft: false}), refreshed.steps);
});
it("does not create or retain a PDF after the preview closes mid-load", async () => {
  const images = deferred<QualityWi>();
  vi.mocked(signWiImages).mockReturnValue(images.promise);
  const view = render(<WiPreview document={document} onClose={() => {}} />);
  view.unmount();
  await act(async () => { images.resolve(refreshed); });
  await waitFor(() => expect(buildQualityWiPdf).not.toHaveBeenCalled());
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it("reports a failed revision request and retries instead of remaining in the loading state", async () => {
  const released = {...document, documentNumber: "WI-QAS-001", title: "Published photos", publishedRevisionId: "release"};
  const revision: WiRevision = {id: "release", revisionIndex: 1, publishedAt: "2026-10-08", changeDescription: "Initial", steps: document.steps, snapshot: wiTemplateDocument(released, 1, "10/08/2026", "Initial")};
  vi.mocked(listWiRevisions).mockRejectedValueOnce(new Error("Could not load published revisions")).mockResolvedValueOnce([revision]);
  render(<WiPreview document={released} publishedOnly onClose={() => {}} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load published revisions");
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.click(screen.getByRole("button", {name: "Retry preview"}));
  await screen.findByText("Rendered document");
  expect(buildQualityWiPdf).toHaveBeenCalledWith(expect.objectContaining({documentNumber: "WI-QAS-001", isDraft: false}), refreshed.steps);
});
it("keeps Word export available when image access succeeds but PDF preparation fails", async () => {
  vi.mocked(buildQualityWiPdf).mockRejectedValue(new Error("PDF preparation failed"));
  render(<WiPreview document={document} onClose={() => {}} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("PDF preparation failed");
  expect(screen.getByRole("button", {name: "Word"})).toBeEnabled();
  expect(screen.getByRole("button", {name: "PDF"})).toBeDisabled();
});
