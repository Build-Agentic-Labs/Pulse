import { describe, expect, it } from "vitest";
import type { Department } from "@/domain/departments";
import { formatResponsibleParty, parseResponsibleParty } from "./responsible-parties";

const departments: Department[] = [
  { id: "pro", workspaceId: "w", code: "PRO", name: "Process Engineering", isQualityGate: false },
  { id: "qa", workspaceId: "w", code: "QA", name: "Quality", isQualityGate: true },
];

describe("responsible party selections", () => {
  it("round trips a controlled department and position", () => {
    const value = formatResponsibleParty(departments[0], "Process Engineer");
    expect(value).toBe("Process Engineering: Process Engineer");
    expect(parseResponsibleParty(value, departments)).toEqual({
      departmentId: "pro",
      positionTitle: "Process Engineer",
      importedValue: "",
    });
  });

  it("infers the department for a standard legacy position", () => {
    expect(parseResponsibleParty("Quality Manager", departments)).toEqual({
      departmentId: "qa",
      positionTitle: "Quality Manager",
      importedValue: "",
    });
  });

  it("preserves an unmapped converted value until the author remaps it", () => {
    expect(parseResponsibleParty("Process Owners", departments)).toEqual({
      departmentId: "",
      positionTitle: "",
      importedValue: "Process Owners",
    });
  });
});
