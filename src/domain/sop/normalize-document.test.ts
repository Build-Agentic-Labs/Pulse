import { describe, expect, it } from "vitest";
import { createEmptySop } from "./schema";
import { normalizeSopDocument } from "./normalize-document";

describe("SOP document recovery", () => {
  it.each([null, {}, { body: "synthetic" }, [], "invalid"])("opens incomplete data safely without mutating it: %j", value => {
    const before = JSON.stringify(value);
    const { sop, recovered } = normalizeSopDocument(value, "sop-test", "2026-10-22");
    expect(recovered).toBe(true);
    expect(sop.procedure.activities).toEqual([]);
    expect(sop.procedure.roles).toEqual([]);
    expect(sop.meta.title.trim()).toBe("");
    expect(sop.changeHistory.map(row => row.changes)).toEqual([]);
    expect(JSON.stringify(value)).toBe(before);
  });
  it("repairs nested invalid values while preserving usable content", () => {
    const value = { ...createEmptySop("s1", "2026-10-22"), purpose: "Keep inspections consistent", scope: {}, definitions: [null, { term: 4 }], responsiblePersons: [null], changeHistory: [null], procedure: { roles: null, activities: [null, { id: {}, description: 42, assignments: null, decisionBranches: { yesTargetActivityId: [] } }] } };
    const { sop, recovered } = normalizeSopDocument(value, "s1", "2026-10-22");
    expect(recovered).toBe(true);
    expect(sop.purpose).toBe("Keep inspections consistent");
    expect(sop.scope).toBe("");
    expect(sop.definitions.every(row => typeof row.term === "string" && typeof row.definition === "string")).toBe(true);
    expect(sop.procedure.activities.map(row => row.description.trim())).toEqual(["", ""]);
    expect(sop.procedure.activities.every(row => row.id && typeof row.assignments === "object")).toBe(true);
  });
  it("keeps a valid SOP unchanged", () => {
    const value = createEmptySop("s1", "2026-10-22");
    value.purpose = "A valid document";
    const result = normalizeSopDocument(value, "s1", "2026-10-22");
    expect(result.recovered).toBe(false);
    expect(result.sop).toEqual(value);
  });
});
