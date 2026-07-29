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
          decisionBranches: { yesTargetStep: null, noTargetStep: 1 },
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
    approvals: [
      { role: "Quality Approval", name: "Jane Doe", position: "QM", date: "2026-02-01", department: "Quality" },
    ],
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
    expect(result!.approvals).toEqual([
      { role: "Quality Approval", name: "Jane", position: "", date: "", department: "" },
    ]);

    const activities = result!.procedure.activities;
    expect(activities).toHaveLength(2);
    expect(activities[0].description).toBe("First real step");
    expect(activities[0].step).toBe(1); // -2 is invalid → positional fallback
    expect(activities[1].description).toBe("Second real step");
    expect(activities[1].step).toBe(3); // positional fallback uses the pre-drop index
  });

  it("coerces decision branch step numbers and preserves an explicit end", () => {
    const input = validExtraction() as unknown as Record<string, unknown>;
    const procedure = input.procedure as Record<string, unknown>;
    const activities = procedure.activities as Array<Record<string, unknown>>;
    activities[1].decisionBranches = {
      yesTargetStep: "1",
      noTargetStep: null,
    };

    const result = validateExtractedSop(input);

    expect(result?.procedure.activities[1].decisionBranches).toEqual({
      yesTargetStep: 1,
      noTargetStep: null,
    });
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

describe("literal escape sequences from the model", () => {
  // Observed in production 2026-07-25: 3 of 6 converted SOPs carried two-character `\n`
  // sequences in `purpose` / `scope`, where the model double-escaped a break while writing
  // multi-paragraph prose into a JSON string. All 19 occurrences were either a paragraph pair or
  // a break introducing a bullet. No authored SOP has ever carried one.
  it("normalizes a double-escaped paragraph break", () => {
    const raw = { ...validExtraction(), purpose: String.raw`First para.\n\nSecond para.` };
    expect(validateExtractedSop(raw)?.purpose).toBe("First para.\n\nSecond para.");
  });

  it("normalizes a break that introduces a list item", () => {
    const raw = { ...validExtraction(), scope: String.raw`It covers:\n- Documents\n- Records` };
    expect(validateExtractedSop(raw)?.scope).toBe("It covers:\n- Documents\n- Records");
  });

  it("leaves a genuine newline untouched", () => {
    const raw = { ...validExtraction(), purpose: "First para.\n\nSecond para." };
    expect(validateExtractedSop(raw)?.purpose).toBe("First para.\n\nSecond para.");
  });

  // The correction must never rewrite content. A backslash-n mid-word is a path, not a break,
  // and staying wrong here is safer than silently editing a controlled document.
  it("leaves a Windows path alone, in either case", () => {
    const lower = { ...validExtraction(), scope: String.raw`Stored at C:\network\share.` };
    expect(validateExtractedSop(lower)?.scope).toBe(String.raw`Stored at C:\network\share.`);
    const upper = { ...validExtraction(), scope: String.raw`Stored at C:\Network\share.` };
    expect(validateExtractedSop(upper)?.scope).toBe(String.raw`Stored at C:\Network\share.`);
  });

  it("leaves other backslash sequences alone", () => {
    const raw = { ...validExtraction(), scope: String.raw`A 5\10 tolerance and a \tab token.` };
    expect(validateExtractedSop(raw)?.scope).toBe(String.raw`A 5\10 tolerance and a \tab token.`);
  });
});
