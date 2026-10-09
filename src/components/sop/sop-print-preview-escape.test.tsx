import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createEmptySop } from "@/domain/sop/schema";
import { ModalSurface } from "@/components/ui/modal-surface";
import { handleAuditPanelEscape } from "./sop-editor";
import { SopPrintPreview } from "./sop-print-preview";

vi.mock("@/lib/sop/approval-entries", () => ({
  buildApprovalEntries: vi.fn(() => new Promise(() => {})),
}));
vi.mock("./use-paginated-pages", () => ({
  usePaginatedPages: () => ({ offscreenRef: { current: null }, sectionPages: [], trailingPages: [], measuring: true, failed: false }),
}));
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));
const sop = createEmptySop("escape-test", "2026-10-09T00:00:00Z");
function auditListener(close: () => void) {
  const listener = (event: KeyboardEvent) => handleAuditPanelEscape(event, close);
  document.addEventListener("keydown", listener, true);
  cleanups.push(() => document.removeEventListener("keydown", listener, true));
}

describe("SOP preview Escape integration", () => {
  it("uses native cancel for an overlay and leaves the audit panel open", () => {
    const close = vi.fn(), auditClose = vi.fn();
    auditListener(auditClose);
    render(<SopPrintPreview sop={sop} annexFiles={[]} onClose={close} />);
    const dialog = screen.getByRole("dialog", { name: "SOP document preview" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(auditClose).not.toHaveBeenCalled();
    // jsdom does not implement Escape's native cancel default action.
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(close).toHaveBeenCalledOnce();
    expect(auditClose).not.toHaveBeenCalled();
  });

  it("retains a busy preview when its native dialog receives cancel", () => {
    const close = vi.fn();
    render(<SopPrintPreview sop={sop} annexFiles={[]} onClose={close} commentBusy />);
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("leaves the preview and audit panel open when a nested modal closes", () => {
    const close = vi.fn(), pdfClose = vi.fn(), auditClose = vi.fn();
    auditListener(auditClose);
    render(<SopPrintPreview sop={sop} annexFiles={[]} onClose={close}
      footerActions={<ModalSurface label="Referenced PDF" onCancel={pdfClose}><button>PDF control</button></ModalSurface>} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "PDF control" }), { key: "Escape" });
    fireEvent(screen.getByRole("dialog", { name: "Referenced PDF" }), new Event("cancel", { cancelable: true }));
    expect(pdfClose).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(auditClose).not.toHaveBeenCalled();
  });

  it("closes the audit panel before an embedded preview", () => {
    const close = vi.fn(), auditClose = vi.fn();
    auditListener(auditClose);
    render(<SopPrintPreview sop={sop} annexFiles={[]} onClose={close} embedded />);
    fireEvent.keyDown(screen.getByRole("region", { name: "SOP document preview" }), { key: "Escape" });
    expect(auditClose).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  it("limits embedded Escape handling to its own content", () => {
    const close = vi.fn();
    render(<SopPrintPreview sop={sop} annexFiles={[]} onClose={close} embedded />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("region", { name: "SOP document preview" }), { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
  });
});
