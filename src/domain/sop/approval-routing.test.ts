import { describe, expect, it } from "vitest";
import type { Department } from "@/domain/departments";
import type { SopProcedure } from "./schema";
import { deriveApprovalRouting } from "./approval-routing";

const departments: Department[] = [
  { id: "sales", workspaceId: "w", code: "SAL", name: "Inside Sales", isQualityGate: false },
  { id: "planning", workspaceId: "w", code: "PLN", name: "Planning", isQualityGate: false },
  { id: "quality", workspaceId: "w", code: "QA", name: "Quality", isQualityGate: true },
];

const procedure: SopProcedure = {
  processFlowDescription: "",
  roles: ["Inside Sales", "Planning", "Operations Director"],
  activities: [
    { id: "1", step: 1, description: "Escalate", assignments: { "Inside Sales": "R" } },
    { id: "2", step: 2, description: "Approve", assignments: { Planning: "A" } },
  ],
};

describe("deriveApprovalRouting", () => {
  it("matches responsible-person prefixes to departments and carries RASIC intent", () => {
    expect(
      deriveApprovalRouting(
        [
          "Inside Sales: Initiates the escalation.",
          "Planning: Assesses feasibility.",
          "Operations Director & EVP: Gives final approval.",
        ],
        procedure,
        departments,
      ).map((item) => ({ id: item.department.id, rasic: item.rasic })),
    ).toEqual([
      { id: "sales", rasic: "responsible" },
      { id: "planning", rasic: "accountable" },
    ]);
  });

  it("does not invent departments for unmatched job titles", () => {
    expect(deriveApprovalRouting(["Operations Director: Approves."], procedure, departments)).toEqual([]);
  });

  it("maps a department-qualified job title to the matching department", () => {
    const operations: Department = {
      id: "operations",
      workspaceId: "w",
      code: "OPS",
      name: "Operations",
      isQualityGate: false,
    };
    const operationsProcedure: SopProcedure = {
      ...procedure,
      activities: [
        ...procedure.activities,
        {
          id: "3",
          step: 3,
          description: "Review",
          assignments: { "Operations Director": "R" },
        },
      ],
    };

    expect(
      deriveApprovalRouting(
        ["Operations Director & EVP: Gives final approval."],
        operationsProcedure,
        [...departments, operations],
      ).map((item) => ({ id: item.department.id, rasic: item.rasic })),
    ).toEqual([{ id: "operations", rasic: "responsible" }]);
  });

  it("deduplicates departments and allows only one accountable match", () => {
    const bothAccountable: SopProcedure = {
      ...procedure,
      activities: [{ id: "1", step: 1, description: "Approve", assignments: { "Inside Sales": "A", Planning: "A" } }],
    };
    expect(
      deriveApprovalRouting(["Inside Sales: A", "Inside Sales: duplicate", "Planning: A"], bothAccountable, departments)
        .map((item) => item.rasic),
    ).toEqual(["accountable", "responsible"]);
  });
});
