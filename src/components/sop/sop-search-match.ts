import type { SopSearchResult } from "@/lib/sop/search";

export type SopSearchMatchHandle = {
  target: HTMLElement;
  overlay: HTMLElement;
};

export function clearSopSearchMatch(handle: SopSearchMatchHandle | null): void {
  handle?.overlay.remove();
}

function pixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function createHighlightRect(left: number, top: number, width: number, height: number): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("data-sop-search-match", "true");
  Object.assign(overlay.style, {
    position: "fixed",
    left: `${left}px`,
    top: `${top}px`,
    width: `${Math.max(width, 1)}px`,
    height: `${Math.max(height, 1)}px`,
    pointerEvents: "none",
    zIndex: "70",
    background: "rgba(250, 204, 21, 0.42)",
    borderRadius: "2px",
    boxShadow: "0 0 0 1px rgba(202, 138, 4, 0.12)",
  });
  document.body.append(overlay);
  return overlay;
}

function createInputWordHighlight(
  target: HTMLInputElement,
  text: string,
  query: string,
  matchStart: number,
): HTMLElement | null {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;

  const rect = target.getBoundingClientRect();
  const style = window.getComputedStyle(target);
  context.font = `${style.fontStyle || "normal"} ${style.fontWeight || "400"} ${
    style.fontSize || "13px"
  } ${style.fontFamily || "sans-serif"}`;
  const letterSpacing = pixelValue(style.letterSpacing);
  const prefix = text.slice(0, matchStart);
  const matchedText = text.slice(matchStart, matchStart + query.length);
  const startWidth = context.measureText(prefix).width + prefix.length * letterSpacing;
  const endWidth =
    context.measureText(`${prefix}${matchedText}`).width +
    (prefix.length + matchedText.length) * letterSpacing;
  const metrics = context.measureText(matchedText);
  const fontSize = pixelValue(style.fontSize) || 13;
  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.76;
  const descent = metrics.actualBoundingBoxDescent || fontSize * 0.24;
  const borderLeft = pixelValue(style.borderLeftWidth);
  const borderTop = pixelValue(style.borderTopWidth);
  const borderBottom = pixelValue(style.borderBottomWidth);
  const paddingLeft = pixelValue(style.paddingLeft);
  const paddingTop = pixelValue(style.paddingTop);
  const paddingBottom = pixelValue(style.paddingBottom);
  const contentHeight =
    rect.height - borderTop - borderBottom - paddingTop - paddingBottom;
  const baseline =
    rect.top +
    borderTop +
    paddingTop +
    contentHeight / 2 +
    (ascent - descent) / 2;

  return createHighlightRect(
    rect.left + borderLeft + paddingLeft - target.scrollLeft + startWidth - 1,
    baseline - ascent - 1,
    endWidth - startWidth + 2,
    ascent + descent + 2,
  );
}

function createMirroredWordHighlight(
  target: HTMLElement,
  text: string,
  query: string,
  matchStart: number,
): HTMLElement {
  const rect = target.getBoundingClientRect();
  const style = window.getComputedStyle(target);
  const overlay = document.createElement("div");
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("data-sop-search-match", "true");
  Object.assign(overlay.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    boxSizing: style.boxSizing,
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "70",
    background: "transparent",
    color: "transparent",
    borderTopWidth: style.borderTopWidth,
    borderRightWidth: style.borderRightWidth,
    borderBottomWidth: style.borderBottomWidth,
    borderLeftWidth: style.borderLeftWidth,
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: style.borderRadius,
    paddingTop: style.paddingTop,
    paddingRight: style.paddingRight,
    paddingBottom: style.paddingBottom,
    paddingLeft: style.paddingLeft,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    textAlign: style.textAlign,
    textTransform: style.textTransform,
    whiteSpace: target instanceof HTMLTextAreaElement ? "pre-wrap" : "pre",
    overflowWrap: style.overflowWrap,
    wordBreak: style.wordBreak,
  });

  const mark = document.createElement("mark");
  mark.textContent = text.slice(matchStart, matchStart + query.length);
  Object.assign(mark.style, {
    color: "transparent",
    background: "rgba(250, 204, 21, 0.42)",
    borderRadius: "2px",
    boxShadow: "0 0 0 1px rgba(202, 138, 4, 0.12)",
  });
  overlay.append(
    document.createTextNode(text.slice(0, matchStart)),
    mark,
    document.createTextNode(text.slice(matchStart + query.length)),
  );
  document.body.append(overlay);
  return overlay;
}

function createWordHighlightOverlay(target: HTMLElement, text: string, query: string): HTMLElement | null {
  const matchStart = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (matchStart < 0) return null;
  if (target instanceof HTMLInputElement) {
    return (
      createInputWordHighlight(target, text, query, matchStart) ??
      createMirroredWordHighlight(target, text, query, matchStart)
    );
  }
  return createMirroredWordHighlight(target, text, query, matchStart);
}

export function revealSopSearchMatch({
  root,
  result,
  query,
  resultIndexInStep,
}: {
  root: HTMLElement;
  result: SopSearchResult;
  query: string;
  resultIndexInStep: number;
}): SopSearchMatchHandle | null {
  const textForElement = (element: HTMLElement) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.value.trim();
    }
    return (element.innerText || element.textContent || "").trim();
  };
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]), textarea, a, button, [aria-readonly="true"]',
    ),
  ).filter((element) => {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
  const resultValue = result.value.trim().toLocaleLowerCase();
  const normalizedQuery = query.toLocaleLowerCase();
  const exactMatches = candidates.filter(
    (element) => textForElement(element).toLocaleLowerCase() === resultValue,
  );
  const queryMatches = candidates.filter((element) =>
    textForElement(element).toLocaleLowerCase().includes(normalizedQuery),
  );
  const target =
    exactMatches[0] ??
    queryMatches[Math.min(resultIndexInStep, Math.max(0, queryMatches.length - 1))];
  if (!target) return null;

  target.scrollIntoView?.({ block: "center", behavior: "auto" });
  const overlay = createWordHighlightOverlay(target, textForElement(target), query);
  return overlay ? { target, overlay } : null;
}
