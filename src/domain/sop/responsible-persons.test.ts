import { describe, expect, it } from "vitest";
import { formatResponsiblePersons, parseResponsiblePersons } from "./responsible-persons";

describe("parseResponsiblePersons", () => {
  it("makes one entry per line", () => {
    expect(parseResponsiblePersons("Quality Manager\nProcess Owner")).toEqual([
      "Quality Manager",
      "Process Owner",
    ]);
  });

  it("trims each entry", () => {
    expect(parseResponsiblePersons("  Quality Manager  \n\tProcess Owner ")).toEqual([
      "Quality Manager",
      "Process Owner",
    ]);
  });

  // A blank line is how someone separates paragraphs while typing; it is not an entry, and an
  // empty string in the array would render as a blank line on the controlled document.
  it("drops blank lines rather than storing empty entries", () => {
    expect(parseResponsiblePersons("Quality Manager\n\n   \nProcess Owner\n")).toEqual([
      "Quality Manager",
      "Process Owner",
    ]);
  });

  it("returns nothing for an empty or whitespace-only value", () => {
    expect(parseResponsiblePersons("")).toEqual([]);
    expect(parseResponsiblePersons("   \n  \n")).toEqual([]);
  });

  it("handles CRLF line endings", () => {
    expect(parseResponsiblePersons("Quality Manager\r\nProcess Owner")).toEqual([
      "Quality Manager",
      "Process Owner",
    ]);
  });

  // The old single-line editor wrote the whole typed string as one element, so existing rows
  // hold values like "A; B; C". Parsing must NOT split on the semicolon: a role may legitimately
  // contain one, and the editor has to show exactly what is stored. Those rows are repaired by
  // migration instead.
  it("does not split on semicolons", () => {
    expect(parseResponsiblePersons("Quality Manager; Process Owner")).toEqual([
      "Quality Manager; Process Owner",
    ]);
  });
});

describe("formatResponsiblePersons", () => {
  it("puts one entry per line", () => {
    expect(formatResponsiblePersons(["Quality Manager", "Process Owner"])).toBe(
      "Quality Manager\nProcess Owner",
    );
  });

  it("renders an empty roster as an empty string", () => {
    expect(formatResponsiblePersons([])).toBe("");
  });

  it("round-trips through parse unchanged", () => {
    const entries = ["Quality Manager", "Department Managers / Heads of Department"];
    expect(parseResponsiblePersons(formatResponsiblePersons(entries))).toEqual(entries);
  });
});
