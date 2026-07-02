import { describe, expect, it } from "vitest";
import type { ExtractedSop } from "./extraction";
import { validateExtractedSop } from "./extraction-validate";

/** A complete, well-formed extraction payload (what a healthy model call returns). */
function validExtraction(): ExtractedSop {
  return {
    meta: {
      sopNumber: "SOP-QA-001",
      title: "QMS",
      version: "1.0",
      revisionDate: "2026-01-15",
      effectiveDate: "2026-02-01",
    },
    purpose: "Define the quality management system.",
    scope: "All departments.",
    definitions: [{ term: "QMS", definition: "Quality Management System" }],
    responsiblePersons: ["Quality Manager"],
    references: ["ISO 9001"],
    measurements: ["% of released SOPs"],
    procedure: {
      processFlowDescription: "SOP release flow.",
      roles: ["Quality Manager", "Department Manager"],
      activities: [
        {
          step: 1,
          shape: "terminator",
          input: "Change request",
          description: "SOP change requested",
          detail: "",
          output: "Draft assignment",
          assignments: { "Quality Manager": "R" },
        },
        {
          step: 2,
          shape: "decision",
          input: "Draft SOP",
          description: "Does the draft meet ISO 9001 requirements?",
          detail: "Review the draft against the checklist.",
          output: "Approved draft",
          assignments: { "Quality Manager": "R", "Department Manager": "A" },
        },
      ],
    },
    annexes: [{ label: "Appendix A", description: "Release checklist" }],
    changeHistory: [
      {
        version: "1.0",
        changes: "Initial release",
        createdByName: "Jane Doe",
        createdByPosition: "QM",
        createdByDate: "2026-01-15",
      },
    ],
    approvals: [{ role: "Quality Approval", name: "Jane Doe", position: "QM", date: "2026-02-01" }],
  };
}

describe("validateExtractedSop", () => {
  it("passes a valid extraction through unchanged", () => {
    const input = validExtraction();
    expect(validateExtractedSop(input)).toEqual(input);
  });

  it("coerces wrong-typed scalars and defaults missing sections", () => {
    const result = validateExtractedSop({
      meta: { sopNumber: 42, title: "QMS", version: 1.5, revisionDate: null, effectiveDate: true },
      purpose: 123,
      scope: { nested: "object" },
      // definitions / responsiblePersons / references / annexes / changeHistory / approvals missing
      measurements: "not-an-array",
      procedure: {
        processFlowDescription: null,
        roles: ["QM", 7, null, { role: "bad" }],
        activities: [
          {
            step: "3",
            shape: "hexagon",
            input: null,
            description: "Review the draft",
            detail: 99,
            output: undefined,
            assignments: { QM: "r", DM: "X", "": "A", Lead: 5 },
          },
        ],
      },
    });

    expect(result).not.toBeNull();
    expect(result!.meta).toEqual({
      sopNumber: "42",
      title: "QMS",
      version: "1.5",
      revisionDate: "",
      effectiveDate: "true",
    });
    expect(result!.purpose).toBe("123");
    expect(result!.scope).toBe("");
    expect(result!.definitions).toEqual([]);
    expect(result!.responsiblePersons).toEqual([]);
    expect(result!.measurements).toEqual([]);
    expect(result!.annexes).toEqual([]);
    expect(result!.changeHistory).toEqual([]);
    expect(result!.approvals).toEqual([]);
    expect(result!.procedure.roles).toEqual(["QM", "7"]);

    const [activity] = result!.procedure.activities;
    expect(activity.step).toBe(3); // numeric string coerced
    expect(activity.shape).toBeUndefined(); // unknown shape dropped
    expect(activity.input).toBe("");
    expect(activity.detail).toBe("99");
    expect(activity.output).toBe("");
    expect(activity.assignments).toEqual({ QM: "R" }); // lowercase normalized; invalid codes dropped
  });

  it("drops malformed array entries and falls back to positional step numbers", () => {
    const result = validateExtractedSop({
      meta: { sopNumber: "SOP-1", title: "T", version: "1", revisionDate: "", effectiveDate: "" },
      purpose: "p",
      scope: "s",
      definitions: [null, "just a string", 7, { term: "QMS", definition: "Quality Management System" }, {}],
      responsiblePersons: ["QM", null, { name: "bad" }, ""],
      references: [],
      measurements: [],
      procedure: {
        processFlowDescription: "",
        roles: [],
        activities: [
          null,
          "garbage",
          { step: -2, description: "First real step", assignments: {} },
          { step: 0, description: "", detail: "", input: "", output: "" }, // textless → dropped
          { description: "Second real step" },
        ],
      },
      annexes: [42, { label: "", description: "" }, { label: "Appendix A", description: "Form" }],
      changeHistory: ["nope", { version: "1.0", changes: "Initial" }],
      approvals: [null, { role: "Quality Approval", name: "Jane" }],
    });

    expect(result).not.toBeNull();
    expect(result!.definitions).toEqual([{ term: "QMS", definition: "Quality Management System" }]);
    expect(result!.responsiblePersons).toEqual(["QM"]);
    expect(result!.annexes).toEqual([{ label: "Appendix A", description: "Form" }]);
    expect(result!.changeHistory).toEqual([
      { version: "1.0", changes: "Initial", createdByName: "", createdByPosition: "", createdByDate: "" },
    ]);
    expect(result!.approvals).toEqual([{ role: "Quality Approval", name: "Jane", position: "", date: "" }]);

    const activities = result!.procedure.activities;
    expect(activities).toHaveLength(2);
    expect(activities[0].description).toBe("First real step");
    expect(activities[0].step).toBe(1); // -2 is invalid → positional fallback
    expect(activities[1].description).toBe("Second real step");
    expect(activities[1].step).toBe(3); // positional fallback uses the pre-drop index
  });

  it("clamps oversized strings to the field caps", () => {
    const result = validateExtractedSop({
      meta: { sopNumber: "x".repeat(10_000), title: "T", version: "", revisionDate: "", effectiveDate: "" },
      purpose: "p".repeat(100_000),
      scope: "",
      definitions: [],
      responsiblePersons: [],
      references: [],
      measurements: [],
      procedure: { processFlowDescription: "", roles: [], activities: [] },
      annexes: [],
      changeHistory: [],
      approvals: [],
    });

    expect(result).not.toBeNull();
    expect(result!.meta.sopNumber).toHaveLength(2_000);
    expect(result!.purpose).toHaveLength(50_000);
  });

  it.each([
    ["null", null],
    ["a string", "not an object"],
    ["an array", [1, 2, 3]],
    ["a number", 42],
  ])("returns null for unusable input: %s", (_label, input) => {
    expect(validateExtractedSop(input)).toBeNull();
  });

  it("returns null for an object with no meaningful content", () => {
    expect(validateExtractedSop({})).toBeNull();
    expect(
      validateExtractedSop({
        meta: { sopNumber: "", title: "", version: "", revisionDate: "", effectiveDate: "" },
        purpose: "",
        scope: "",
        procedure: { processFlowDescription: "", roles: [], activities: [] },
      }),
    ).toBeNull();
  });

  it("keeps a payload whose only content is procedure activities", () => {
    const result = validateExtractedSop({
      procedure: { activities: [{ step: 1, description: "Receive order", assignments: {} }] },
    });
    expect(result).not.toBeNull();
    expect(result!.procedure.activities).toHaveLength(1);
    expect(result!.meta.title).toBe("");
  });
});
