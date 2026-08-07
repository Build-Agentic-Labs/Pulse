import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEmptySop } from "@/domain/sop/schema";
import { applySampleData } from "@/domain/sop/sample";
import { buildProcedureSvgPages } from "./procedure-flow-image";

// buildProcedureSvgPages measures text via a <canvas> 2d context; stub it so the SVG geometry
// can be exercised in Node. (The actual rasterization to PNG is browser-only and untested here.)
const realDocument = (globalThis as { document?: unknown }).document;

beforeAll(() => {
  const ctx = { font: "", measureText: (text: string) => ({ width: text.length * 7 }) };
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ getContext: () => ctx }),
  };
});

afterAll(() => {
  (globalThis as { document?: unknown }).document = realDocument;
});

describe("buildProcedureSvgPages", () => {
  const sop = applySampleData(createEmptySop("svg", "2026-01-01T00:00:00.000Z"));
  const acts = sop.procedure.activities;
  const decisions = acts.filter((a) => a.shape === "decision").length;

  it("emits flowchart pages with the right shape per step and full-width sizing", () => {
    const pages = buildProcedureSvgPages(sop);
    expect(pages.length).toBeGreaterThanOrEqual(1);
    const allSvg = pages.map((p) => p.svg).join("");

    expect(pages[0].svg.startsWith("<svg")).toBe(true);
    expect(pages[0].logicalWidth).toBe(700);
    pages.forEach((p) => {
      expect(p.displayWidth).toBe(672); // full printable content width
      expect(p.displayHeight).toBeLessThanOrEqual(800); // capped near one page so it clears the footer
    });

    // Non-decision steps render as rounded rectangles (rx); the column frames carry a class, so
    // exclude those. Node rects spread across pages, never duplicated.
    const nodeRects = (allSvg.match(/<rect (?![^>]*\bclass=)[^>]*\brx=/g) || []).length;
    expect(nodeRects).toBe(acts.length - decisions);

    // Each page draws three side-column frames (Input / Output / RASIC).
    const frames = (allSvg.match(/<rect class="col-frame"/g) || []).length;
    expect(frames).toBe(pages.length * 3);

    // Decision steps render as 4-point diamond polygons (arrowheads are 3-point polygons).
    const diamonds = (allSvg.match(/<polygon points="([^"]*)"/g) || []).filter(
      (p) => p.match(/points="([^"]*)"/)![1].trim().split(/\s+/).length === 4,
    ).length;
    expect(diamonds).toBe(decisions);
    expect(decisions).toBe(1);

    // Ordinary steps keep the linear connector. The configured decision replaces its linear
    // connector with one labelled path per outcome.
    expect((allSvg.match(/<line /g) || []).length).toBe(acts.length - pages.length - decisions);
    expect((allSvg.match(/class="decision-branch decision-branch-/g) || []).length).toBe(2);
    expect(allSvg).toContain('data-branch="yes"');
    expect(allSvg).toContain('data-branch="no"');
    expect(allSvg).toContain(">Yes</text>");
    expect(allSvg).toContain(">No</text>");
    expect(allSvg).toContain('width="216"');
    expect(allSvg).toMatch(
      /class="decision-branch decision-branch-no" data-branch="no" d="M 388 [^"]* H 412 V [^"]* H 388"/,
    );

    expect(allSvg).toContain("compliant?");
    expect(allSvg).toContain("Approved SOP");
    expect((allSvg.match(/class="input-step-number"/g) || []).length).toBe(acts.length);
    acts.forEach((activity) => {
      expect(allSvg).toContain(`class="input-step-number" x="16"`);
      expect(allSvg).toContain(`>Step ${activity.step}</text>`);
    });
  });

  it("splits a long flow across pages, repeating headers with a continued label", () => {
    const tall = applySampleData(createEmptySop("tall", "2026-01-01T00:00:00.000Z"));
    tall.procedure.activities = Array.from({ length: 40 }, (_, i) => ({
      id: `t-${i}`,
      step: i + 1,
      shape: "process" as const,
      input: "Input item",
      description: `Process step number ${i + 1} with a reasonably long action label`,
      output: "Output item",
      assignments: { Quality: "R" as const },
    }));
    const pages = buildProcedureSvgPages(tall);

    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((p) => expect(p.svg).toContain("Process step")); // headers repeat on every page
    expect(pages[1].svg).toContain("continued"); // continuation pages are labelled
    expect(pages.flatMap((page) => page.svg.match(/class="input-step-number"/g) ?? [])).toHaveLength(40);
    expect(pages.at(-1)?.svg).toContain(">Step 40</text>");
  });

  it("renders a labelled cross-page stub and a side terminal for an End branch", () => {
    const boundary = createEmptySop("boundary", "2026-01-01T00:00:00.000Z");
    boundary.procedure.activities = [
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `before-${index}`,
        step: index + 1,
        shape: "process" as const,
        description: `Prepare item ${index + 1}`,
        assignments: {},
      })),
      {
        id: "page-end-decision",
        step: 7,
        shape: "decision" as const,
        description: "Has every required condition been reviewed and accepted for release?",
        decisionBranches: { yesTargetActivityId: "next-page", noTargetActivityId: null },
        assignments: {},
      },
      {
        id: "next-page",
        step: 8,
        shape: "process" as const,
        description: "Release item",
        assignments: {},
      },
    ];

    const pages = buildProcedureSvgPages(boundary);

    expect(pages).toHaveLength(2);
    expect(pages[0].svg).toContain("Yes → Step 8");
    expect(pages[0].svg).toContain('class="decision-branch-stub decision-branch-stub-yes" x="172"');
    expect(pages[0].svg).not.toContain("No → End");
    expect(pages[0].svg).toContain(
      'class="decision-branch decision-branch-no decision-branch-end" data-branch="no" d="M 388',
    );
    expect(pages[0].svg).toContain(
      'class="decision-branch-terminal decision-branch-terminal-no" cx="405"',
    );
    expect(pages[0].svg).toContain(">End</text>");
  });
});
