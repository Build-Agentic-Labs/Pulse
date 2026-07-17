import {
  standardPositionTitlesForDepartment,
  type Department,
} from "@/domain/departments";

export interface ResponsiblePartySelection {
  departmentId: string;
  positionTitle: string;
  importedValue: string;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findDepartment(label: string, departments: readonly Department[]): Department | undefined {
  const normalizedLabel = normalize(label);
  if (!normalizedLabel) return undefined;

  return departments.find((department) => {
    const normalizedName = normalize(department.name);
    const normalizedCode = normalize(department.code);
    return normalizedLabel === normalizedName || normalizedLabel === normalizedCode;
  });
}

/**
 * Convert the stored, printable `Department: Position` value into controlled editor fields.
 * Older converted SOPs may contain only a position; infer its department when it matches a
 * controlled title. Truly free-form legacy values remain visible until the author remaps them.
 */
export function parseResponsibleParty(
  value: string,
  departments: readonly Department[],
): ResponsiblePartySelection {
  const separator = value.indexOf(":");
  if (separator >= 0) {
    const department = findDepartment(value.slice(0, separator), departments);
    if (department) {
      return {
        departmentId: department.id,
        positionTitle: value.slice(separator + 1).trim(),
        importedValue: "",
      };
    }
  }

  const normalizedValue = normalize(value);
  const titleDepartment = departments.find((department) =>
    standardPositionTitlesForDepartment(department.code).some(
      (title) => normalize(title) === normalizedValue,
    ),
  );
  if (titleDepartment) {
    return {
      departmentId: titleDepartment.id,
      positionTitle: value.trim(),
      importedValue: "",
    };
  }

  return { departmentId: "", positionTitle: "", importedValue: value.trim() };
}

/** Store a stable department key for routing while keeping the SOP text readable. */
export function formatResponsibleParty(department: Department, positionTitle: string): string {
  const title = positionTitle.trim();
  return title ? `${department.name}: ${title}` : department.name;
}
