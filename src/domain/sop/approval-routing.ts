import type { Department } from "@/domain/departments";
import type { SopProcedure } from "./schema";

export interface ApprovalRoutingCandidate {
  department: Department;
  rasic: "responsible" | "accountable";
}

function normalizeRoutingName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bdepartment\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function responsibleLabel(value: string): string {
  return value.split(":", 1)[0]?.trim() ?? "";
}

function findRoutingDepartment(
  normalizedLabel: string,
  departments: readonly Department[],
): Department | undefined {
  const exactMatch = departments.find((item) => {
    const normalizedName = normalizeRoutingName(item.name);
    const normalizedCode = normalizeRoutingName(item.code);
    return normalizedLabel === normalizedName || normalizedLabel === normalizedCode;
  });
  if (exactMatch) return exactMatch;

  // Converted documents often name a department through a job title, such as
  // "Operations Director & EVP". Prefer the longest department-name prefix so
  // a specific department wins if names overlap.
  return departments
    .filter((item) => {
      const normalizedName = normalizeRoutingName(item.name);
      return normalizedName && normalizedLabel.startsWith(`${normalizedName} `);
    })
    .sort(
      (left, right) =>
        normalizeRoutingName(right.name).length - normalizeRoutingName(left.name).length,
    )[0];
}

/**
 * Match the department names embedded in Responsible person(s) to real workspace departments.
 * RASIC assignments decide whether a matched department is Responsible or Accountable; only the
 * first Accountable match is kept because the lifecycle permits exactly one Accountable seat.
 */
export function deriveApprovalRouting(
  responsiblePersons: readonly string[],
  procedure: SopProcedure,
  departments: readonly Department[],
): ApprovalRoutingCandidate[] {
  const candidates: ApprovalRoutingCandidate[] = [];
  const seen = new Set<string>();
  let accountableAssigned = false;

  for (const entry of responsiblePersons) {
    const label = responsibleLabel(entry);
    const normalizedLabel = normalizeRoutingName(label);
    if (!normalizedLabel) continue;

    const department = findRoutingDepartment(normalizedLabel, departments);
    if (!department || seen.has(department.id)) continue;

    const matchingRoles = procedure.roles.filter((role) => {
      const normalizedRole = normalizeRoutingName(role);
      return (
        normalizedRole === normalizedLabel ||
        normalizedRole === normalizeRoutingName(department.name) ||
        normalizedLabel.startsWith(`${normalizedRole} `)
      );
    });
    const codes = procedure.activities.flatMap((activity) =>
      matchingRoles.flatMap((role) => activity.assignments[role] ? [activity.assignments[role]] : []),
    );
    const wantsAccountable = codes.includes("A");
    const rasic = wantsAccountable && !accountableAssigned ? "accountable" : "responsible";

    if (rasic === "accountable") accountableAssigned = true;
    seen.add(department.id);
    candidates.push({ department, rasic });
  }

  return candidates;
}
