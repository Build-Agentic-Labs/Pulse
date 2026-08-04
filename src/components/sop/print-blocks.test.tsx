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

  // The em-dash empty state belongs to a section with no content at all. A blank
  // line INSIDE authored prose is paragraph spacing — the old pre-wrap rendering
  // showed one empty text line, so it must render as a non-breaking space, never
  // as a dash row in the middle of a controlled document.
  it("renders an interior blank line as spacing, not an em-dash", () => {
    const { sections } = buildPrintBlocks(sopWith({ purpose: "First.\n\nSecond." }));
    const body = sections.filter((b) => b.category === "purpose" && !b.keepWithNext);
    expect(body).toHaveLength(3);
    const { container } = render(<>{body[1].render()}</>);
    expect(container.querySelector("p")?.textContent).toBe(" ");
    expect(container.querySelector("p.sop-export-empty")).toBeNull();
  });

  it("renders a wholly empty section as the em-dash empty state", () => {
    const { sections } = buildPrintBlocks(sopWith({ purpose: "" }));
    const body = sections.filter((b) => b.category === "purpose" && !b.keepWithNext);
    expect(body).toHaveLength(1);
    const { container } = render(<>{body[0].render()}</>);
    expect(container.querySelector("p.sop-export-empty")?.textContent).toBe("—");
  });

  it("honors provided extras: approvals table, annex file lines, change author", () => {
    const sop = sopWith({
      annexes: [{ id: "ax1", label: "Annex A", description: "Inspection form" }],
      changeHistory: [{ version: "1.0", changes: "Initial", createdByDate: "2026-08-01" }],
    });
    const { trailing } = buildPrintBlocks(sop, {
      approvalsTable: <table data-testid="injected-approvals" />,
      annexFileLines: new Map([["ax1", { name: "form.pdf", error: "could not render" }]]),
      changeAuthor: () => "System Author\n08/01/2026",
    });
    const html = trailing
      .map((block) => render(<>{block.render()}</>).container.innerHTML)
      .join("");
    expect(html).toContain("injected-approvals");
    expect(html).toContain("form.pdf");
    expect(html).toContain("could not render");
    expect(html).toContain("System Author");
  });

  it("omits the approvals section entirely when no table is provided", () => {
    const { trailing } = buildPrintBlocks(sopWith({}));
    const text = trailing
      .map((block) => render(<>{block.render()}</>).container.textContent)
      .join("");
    expect(text).not.toContain("Change Approvals");
  });

  it("renders procedure sub-headings as atomic bold keepWithNext blocks", () => {
    const { sections } = buildPrintBlocks(
      sopWith({
        procedure: {
          processFlowDescription: "4.4 Document Creation\nThe creator may be an employee.",
          roles: [],
          activities: [],
        },
      }),
    );
    const body = sections.filter((b) => b.category === "procedure" && !b.keepWithNext);
    const headings = sections.filter(
      (b) => b.category === "procedure" && b.keepWithNext && b.sectionTitle === "Procedure",
    );
    // The section heading block plus the detected sub-heading block.
    expect(headings.length).toBeGreaterThanOrEqual(1);
    const sub = headings.find((b) => {
      const { container } = render(<>{b.render()}</>);
      return container.querySelector("p.sop-export-subheading") !== null;
    });
    expect(sub).toBeDefined();
    expect(sub!.splittable).toBeFalsy();
    const { container } = render(<>{sub!.render()}</>);
    expect(container.querySelector("p.sop-export-subheading")?.textContent).toBe(
      "4.4 Document Creation",
    );
    expect(container.querySelector("[data-review-category='procedure']")).not.toBeNull();
    // The following prose line is still an ordinary splittable paragraph block.
    expect(body.some((b) => b.splittable)).toBe(true);
  });

  it("renders procedure bullet lines as list items with the glyph stripped", () => {
    const { sections } = buildPrintBlocks(
      sopWith({
        procedure: {
          processFlowDescription: "The creator shall:\n• Use the approved corporate template.",
          roles: [],
          activities: [],
        },
      }),
    );
    const body = sections.filter((b) => b.category === "procedure" && !b.keepWithNext);
    const bulletBlock = body.find((b) => {
      const { container } = render(<>{b.render()}</>);
      return container.querySelector("ul.sop-export-list li") !== null;
    });
    expect(bulletBlock).toBeDefined();
    expect(bulletBlock!.splittable).toBeFalsy();
    const { container } = render(<>{bulletBlock!.render()}</>);
    expect(container.querySelector("ul.sop-export-list li")?.textContent).toBe(
      "Use the approved corporate template.",
    );
  });

  it("leaves purpose and scope classification-free", () => {
    const { sections } = buildPrintBlocks(
      sopWith({ purpose: "4.4 Document Creation\n• Not a bullet here." }),
    );
    const body = sections.filter((b) => b.category === "purpose" && !b.keepWithNext);
    for (const block of body) {
      const { container } = render(<>{block.render()}</>);
      expect(container.querySelector("p.sop-export-subheading")).toBeNull();
      expect(container.querySelector("ul")).toBeNull();
      expect(block.splittable).toBe(true);
    }
  });
});
