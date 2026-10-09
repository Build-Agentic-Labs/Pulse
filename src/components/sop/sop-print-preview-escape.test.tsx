import { afterEach, describe, expect, it, vi } from "vitest";
import { handlePreviewEscape, listenForPreviewEscape } from "./sop-print-preview";

function layers(overrides: Partial<Parameters<typeof handlePreviewEscape>[1]> = {}) {
  return {
    busy: false,
    commentSelected: false,
    dismissComment: vi.fn(),
    inlineDocOpen: false,
    closeInlineDoc: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

function escape(): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

describe("handlePreviewEscape", () => {
  it("closes only the inline document when one is open, and consumes the key", () => {
    const state = layers({ inlineDocOpen: true });
    const event = escape();
    const stop = vi.spyOn(event, "stopImmediatePropagation");
    handlePreviewEscape(event, state);
    expect(state.closeInlineDoc).toHaveBeenCalledOnce();
    expect(state.close).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("closes the preview when no inner layer is open", () => {
    const state = layers();
    const event = escape();
    const stop = vi.spyOn(event, "stopImmediatePropagation");
    handlePreviewEscape(event, state);
    expect(state.close).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("dismisses a pending comment selection before anything else", () => {
    const state = layers({ commentSelected: true, inlineDocOpen: true });
    handlePreviewEscape(escape(), state);
    expect(state.dismissComment).toHaveBeenCalledOnce();
    expect(state.closeInlineDoc).not.toHaveBeenCalled();
    expect(state.close).not.toHaveBeenCalled();
  });

  it("ignores other keys and leaves them to other listeners", () => {
    const state = layers();
    const event = new KeyboardEvent("keydown", { key: "Enter" });
    const stop = vi.spyOn(event, "stopImmediatePropagation");
    handlePreviewEscape(event, state);
    expect(state.close).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });
});

describe("listenForPreviewEscape layering", () => {
  function register(target: Window | Document, capture: boolean, listener: (event: Event) => void) {
    target.addEventListener("keydown", listener, capture);
    cleanups.push(() => target.removeEventListener("keydown", listener, capture));
  }

  it("an overlay preview consumes Escape so listeners beneath it never see the key", () => {
    const state = layers();
    cleanups.push(listenForPreviewEscape(false, (event) => handlePreviewEscape(event, state)));
    const beneath = vi.fn();
    register(window, false, beneath);
    document.body.dispatchEvent(escape());
    expect(state.close).toHaveBeenCalledOnce();
    expect(beneath).not.toHaveBeenCalled();
  });

  it("a referenced PDF over the preview closes alone, whatever the registration order", () => {
    const pdfClose = vi.fn();
    // The print preview registers first; the PDF opened over it later must still win.
    const state = layers();
    cleanups.push(listenForPreviewEscape(false, (event) => handlePreviewEscape(event, state)));
    register(window, true, (event) => {
      event.stopImmediatePropagation();
      pdfClose();
    });
    document.body.dispatchEvent(escape());
    expect(pdfClose).toHaveBeenCalledOnce();
    expect(state.close).not.toHaveBeenCalled();
  });

  it("an embedded preview yields to the audit panel drawn above it", () => {
    const state = layers();
    // Embedded preview registered after the panel (its listener re-registers on every dependency change).
    const auditClose = vi.fn();
    register(document, true, (event) => {
      event.stopImmediatePropagation();
      auditClose();
    });
    cleanups.push(listenForPreviewEscape(true, (event) => handlePreviewEscape(event, state)));
    document.body.dispatchEvent(escape());
    expect(auditClose).toHaveBeenCalledOnce();
    expect(state.close).not.toHaveBeenCalled();
  });

  it("an embedded preview closes on Escape when no layer is above it", () => {
    const state = layers();
    cleanups.push(listenForPreviewEscape(true, (event) => handlePreviewEscape(event, state)));
    document.body.dispatchEvent(escape());
    expect(state.close).toHaveBeenCalledOnce();
  });
});
