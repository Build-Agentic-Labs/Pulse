import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildPrintBlocks } from "./print-blocks";
import { createEmptySop } from "@/domain/sop/schema";

// createEmptySop(id, now) — both arguments are required; fixed values keep tests deterministic.
function sopWith(overrides: Record<string, unknown>) {
  return {
    ...createEmptySop("sop-test", "2026-08-03T00:00:00.000Z"),
    ...overrides,
  } as Parameters<typeof buildPrintBlocks>[0];
}

describe("buildPrintBlocks", () => {
  it("emits a keepWithNext heading before each section's content", () => {
    const { sections } = buildPrintBlocks(sopWith({ purpose: "Establish a method." }));
    const purpose = sections.filter((b) => b.category === "purpose");
    expect(purpose[0].keepWithNext).toBe(true);
    expect(purpose[1].keepWithNext).toBeFalsy();
  });

  it("splits prose into one splittable block per line", () => {
    const { sections } = buildPrintBlocks(sopWith({ purpose: "First line.\nSecond line.\nThird line." }));
    const body = sections.filter((b) => b.category === "purpose" && !b.keepWithNext);
    expect(body).toHaveLength(3);
    expect(body.every((b) => b.splittable)).toBe(true);
  });

  // The six SOPs whose Procedure has zero newlines are exactly why a single
  // paragraph must still be marked splittable: the packer cuts it by line count.
  it("marks a paragraph with no newlines as splittable", () => {
    const { sections } = buildPrintBlocks(sopWith({ purpose: "A".repeat(4000) }));
    const body = sections.filter((b) => b.category === "purpose" && !b.keepWithNext);
    expect(body).toHaveLength(1);
    expect(body[0].splittable).toBe(true);
  });

  it("emits one non-splittable block per list item", () => {
    const { sections } = buildPrintBlocks(sopWith({ measurements: ["First KPI", "Second KPI"] }));
    const body = sections.filter((b) => b.category === "measurements" && !b.keepWithNext);
    expect(body).toHaveLength(2);
    expect(body.every((b) => b.splittable)).toBeFalsy();
  });

  it("gives every block a unique id across both segments", () => {
    const { sections, trailing } = buildPrintBlocks(
      sopWith({ purpose: "One.\nTwo.", scope: "Three." }),
    );
    const ids = [...sections, ...trailing].map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries the review category onto every block so scroll tracking still works", () => {
    const { sections } = buildPrintBlocks(sopWith({ purpose: "One.\nTwo." }));
    expect(sections.filter((b) => b.category === "purpose")).toHaveLength(3);
  });

  // Blocks are self-contained: a list item brings its own section shell and
  // single-item ul, so stacking blocks needs no grouping helper.
  it("renders a list item as a self-contained block with its review category", () => {
    const { sections } = buildPrintBlocks(sopWith({ measurements: ["First KPI"] }));
    const body = sections.filter((b) => b.category === "measurements" && !b.keepWithNext);
    const { container } = render(<>{body[0].render()}</>);
    expect(container.querySelector("[data-review-category='measurements']")).not.toBeNull();
    expect(container.querySelector("ul.sop-export-list li")?.textContent).toBe("First KPI");
  });

  it("routes annexes and change history into the trailing segment", () => {
    const { sections, trailing } = buildPrintBlocks(
      sopWith({
        changeHistory: [{ version: "1.0", changes: "Initial release", createdByDate: "2026-08-01" }],
      }),
    );
    expect(trailing.some((b) => b.category === "history")).toBe(true);
    expect(sections.some((b) => b.category === "history")).toBe(false);
  });

  it("renders a cut fragment as a clipping window sized to its line range", () => {
    const { sections } = buildPrintBlocks(sopWith({ purpose: "A".repeat(4000) }));
    const body = sections.filter((b) => b.category === "purpose" && !b.keepWithNext);
    const { container } = render(
      <>{body[0].render({ startLine: 10, endLine: 20, lineHeight: 14 })}</>,
    );
    const window = container.firstElementChild as HTMLElement;
    expect(window.style.height).toBe("140px");
    expect(window.style.overflow).toBe("hidden");
    const inner = window.firstElementChild as HTMLElement;
    expect(inner.style.marginTop).toBe("-140px");
    // The full text is present; the window, not the string, does the cutting.
    expect(container.textContent).toBe("A".repeat(4000));
  });

  it("renders the plain paragraph when no line range is given", () => {
    const { sections } = buildPrintBlocks(sopWith({ purpose: "Short." }));
    const body = sections.filter((b) => b.category === "purpose" && !b.keepWithNext);
    const { container } = render(<>{body[0].render()}</>);
    expect(container.querySelector("p")?.textContent).toBe("Short.");
    expect(container.querySelector("div")).toBeNull();
  });
});
