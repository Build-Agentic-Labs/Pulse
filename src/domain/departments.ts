/**
 * Department domain types and role capabilities. Roles are cumulative:
 * `approver` ⊇ `reviewer` ⊇ `author`. Authoring/submitting a draft is open to any
 * department role; signing a review needs ≥ reviewer; the department-approval step
 * needs approver. The independent Quality sign-off is enforced in the database
 * (has_department_role's is_quality_gate branch), not here.
 */

export type DeptRole = "author" | "reviewer" | "approver";

export interface Department {
  id: string;
  workspaceId: string;
  code: string;
  name: string;
  isQualityGate: boolean;
  /** Required SOP count used to measure department completion. Zero means not configured. */
  sopTarget: number;
}

export interface DepartmentMember {
  departmentId: string;
  userId: string;
  deptRole: DeptRole;
  /** Organizational job title, separate from the member's SOP access level. */
  positionTitle: string;
}

const STANDARD_POSITION_TITLES: Record<string, readonly string[]> = {
  INS: ["VP Sales", "Director Sales", "Inside Sales Manager", "Sales Manager", "Senior Sales Representative", "Inside Sales Representative", "Sales Coordinator"],
  INV: ["Inventory Control Manager", "Inventory Control Supervisor", "Inventory Analyst", "Inventory Control Specialist"],
  LOG: ["Logistics Manager", "Logistics Supervisor", "Logistics Coordinator", "Logistics Specialist"],
  MFG: ["VP Manufacturing", "Director Manufacturing", "Manufacturing Manager", "Production Manager", "Production Supervisor", "Manufacturing Engineer", "Production Specialist"],
  PLN: ["Director Planning", "Planning Manager", "Planning Supervisor", "Senior Planner", "Planner"],
  PRO: ["VP Engineering", "Director Engineering", "Director Industrial Engineering", "Process Engineering Manager", "Industrial Engineering Manager", "Process Engineer", "Industrial Engineer", "Engineering Technician"],
  PUR: ["VP Purchasing", "Director Purchasing", "Purchasing Manager", "SCM Manager", "Senior Buyer", "Buyer", "Purchasing Specialist"],
  QAS: ["VP Quality", "Director Quality", "Quality Manager", "QA Manager", "Quality Engineer", "Quality Specialist", "Quality Technician"],
  SVC: ["VP Service", "Director Service", "Service Manager", "Field Service Manager", "Service Supervisor", "Service Technician", "Customer Service Representative"],
};

const DEFAULT_POSITION_TITLES = [
  "Executive Vice President",
  "Vice President",
  "Director",
  "Senior Manager",
  "Manager",
  "Supervisor",
  "Team Lead",
  "Senior Specialist",
  "Specialist",
  "Coordinator",
  "Technician",
] as const;

/** Controlled organizational titles offered for a department's people roster. */
export function standardPositionTitlesForDepartment(code: string): readonly string[] {
  return STANDARD_POSITION_TITLES[code.trim().toUpperCase()] ?? DEFAULT_POSITION_TITLES;
}

// ---------------------------------------------------------------------------
// RASIC role vocabulary — deliberately NOT the same list as the position titles above.
//
// A position title names a person on the roster. A RASIC role names an actor in a process, and
// some actors are collective: "Associates/Employees" and "Board of Management" belong in a
// responsibility matrix but must never be offered when assigning a job title to a real employee.
// ---------------------------------------------------------------------------

/**
 * Cross-department process actors, offered to every department.
 *
 * Shipped in code rather than seeded into sop_rasic_roles: no per-workspace bootstrap, a new
 * workspace works on day one, and this baseline cannot be deleted the way a row can. Curation
 * (rename/delete, owner/admin only) therefore applies exactly where drift happens — the roles
 * authors type.
 */
export const GENERAL_RASIC_ROLES = [
  "EVP Operations",
  "Supervisor",
  "Team Leader",
  "Quality Inspector",
  "Operator",
  "Associates/Employees",
  "HoD (Heads of Department)",
  "Board of Management",
] as const;

// ---------------------------------------------------------------------------
// Job titles — the title a PERSON holds on a department roster.
//
// Deliberately not the same vocabulary as the RASIC roles below. A role names an actor in a
// process and may be collective ("Board of Management"); a title names one employee. Offering the
// former when naming the latter is the confusion this separation prevents.
// ---------------------------------------------------------------------------

/** Group heading for titles this workspace typed itself. */
export const ADDED_JOB_TITLES_GROUP = "Added by your team";

/** Longest job title accepted. Generous for real titles, short enough to stay a title. */
const MAX_JOB_TITLE_CHARS = 60;

// Letters, digits, spaces and the punctuation real titles use. Deliberately excludes newlines,
// tabs and control characters, which is what makes a pasted paragraph fail rather than become a
// "title". Unicode letters are allowed so non-English titles are not second-class.
const JOB_TITLE_ALLOWED = /^[\p{L}\p{N} \-/&().,]+$/u;
const STARTS_WITH_LETTER = /^\p{L}/u;

/**
 * Canonical form of a typed job title, or null when it is not shaped like one.
 *
 * Whitespace and uniqueness are normalized; CAPITALIZATION IS NOT, on purpose. Title-casing would
 * turn "PJ Mgr / Operations" into "Pj Mgr", "EVP Operations" into "Evp" and
 * "HoD (Heads of Department)" into "Hod" — silently mangling initialisms that were typed
 * correctly. Consistency comes from blocking near-duplicates, not from imposing a house style on
 * words the app cannot interpret.
 *
 * There is no vocabulary rule: any wording is allowed as long as the shape is right.
 */
export function normalizeJobTitle(raw: string): string | null {
  const trimmed = raw.trim();
  // Reject an INTERIOR line break or tab rather than collapsing it: "Manager\nSupervisor" is two
  // titles pasted together, and quietly turning it into "Manager Supervisor" invents one nobody
  // holds. Leading and trailing whitespace is still forgiven by the trim above.
  if (/[\n\r\t]/.test(trimmed)) return null;
  const collapsed = trimmed.replace(/\s+/g, " ");
  if (collapsed.length === 0 || collapsed.length > MAX_JOB_TITLE_CHARS) return null;
  if (!STARTS_WITH_LETTER.test(collapsed)) return null;
  if (!JOB_TITLE_ALLOWED.test(collapsed)) return null;
  return collapsed;
}

/** One entry of the job-title dropdown. Structurally a ThemedSelectOption, without the import. */
export interface JobTitleOption {
  value: string;
  label: string;
  group: string;
}

/**
 * The grouped job-title dropdown: the department's standard titles, then the workspace's own.
 *
 * Same two properties the role assembly guarantees — groups emitted contiguously (ThemedSelect
 * prints a heading whenever an option's group differs from the previous one) and case-insensitive
 * dedupe with the standard list winning, so a typed duplicate cannot shadow a curated title.
 */
export function jobTitleOptions(
  departmentCode: string,
  workspaceTitles: readonly string[],
): JobTitleOption[] {
  const options: JobTitleOption[] = [];
  const seen = new Set<string>();
  function push(value: string, group: string) {
    const key = value.trim().toLowerCase();
    if (key.length === 0 || seen.has(key)) return;
    seen.add(key);
    options.push({ value, label: value, group });
  }

  for (const title of standardPositionTitlesForDepartment(departmentCode)) push(title, "Standard titles");
  for (const raw of workspaceTitles) {
    const title = normalizeJobTitle(raw);
    if (title) push(title, ADDED_JOB_TITLES_GROUP);
  }
  return options;
}

/** Group heading for the workspace's own typed roles. */
export const ADDED_RASIC_ROLES_GROUP = "Added by your team";

/**
 * Canonical form of a typed role name: trimmed, internal whitespace collapsed, null when there
 * is nothing left. The unique index on (workspace_id, lower(btrim(name))) catches case and edge
 * whitespace; collapsing runs of internal spaces is the part SQL cannot express, so "Team
 * Leader" and "Team  Leader" resolve to one role rather than two.
 */
export function normalizeRasicRoleName(raw: string): string | null {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  return collapsed.length > 0 ? collapsed : null;
}

/** One entry of the RASIC role dropdown. Structurally a ThemedSelectOption, without the import. */
export interface RasicRoleOption {
  value: string;
  label: string;
  group: string;
}

/**
 * The grouped role dropdown, assembled from the three sources in display order: the SOP's owning
 * department, the remaining departments alphabetically, General, then the workspace's own roles.
 *
 * Two properties the callers depend on:
 *  - Each group is emitted CONTIGUOUSLY. ThemedSelect prints a heading whenever an option's
 *    group differs from the previous option's, so a split group would print its heading twice.
 *  - Values are deduped case-insensitively and the first source wins, so a typed duplicate can
 *    never shadow a curated name.
 */
export function rasicRoleOptions(
  owningDepartmentId: string | null | undefined,
  departments: readonly Department[],
  workspaceRoleNames: readonly string[],
): RasicRoleOption[] {
  const ordered = departments.slice().sort((left, right) => {
    if (left.id === owningDepartmentId) return -1;
    if (right.id === owningDepartmentId) return 1;
    return left.name.localeCompare(right.name);
  });

  // A title offered by more than one department is qualified with the department name, so the
  // two stay distinguishable instead of colliding on value.
  const titleCounts = new Map<string, number>();
  for (const department of ordered) {
    for (const title of standardPositionTitlesForDepartment(department.code)) {
      titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
    }
  }

  const options: RasicRoleOption[] = [];
  const seen = new Set<string>();
  function push(value: string, label: string, group: string) {
    const key = value.trim().toLowerCase();
    if (key.length === 0 || seen.has(key)) return;
    seen.add(key);
    options.push({ value, label, group });
  }

  for (const department of ordered) {
    for (const title of standardPositionTitlesForDepartment(department.code)) {
      const qualified = (titleCounts.get(title) ?? 0) > 1;
      push(qualified ? `${title} — ${department.name}` : title, title, department.name);
    }
  }
  for (const role of GENERAL_RASIC_ROLES) push(role, role, "General");
  for (const raw of workspaceRoleNames) {
    const name = normalizeRasicRoleName(raw);
    if (name) push(name, name, ADDED_RASIC_ROLES_GROUP);
  }
  return options;
}

const ORDER: Record<DeptRole, number> = { author: 0, reviewer: 1, approver: 2 };

/** True when `role` sits at or above `min` in the cumulative order. */
export function roleAtLeast(role: DeptRole, min: DeptRole): boolean {
  return ORDER[role] >= ORDER[min];
}

export function canAuthor(role: DeptRole): boolean {
  return roleAtLeast(role, "author");
}

export function canSignReview(role: DeptRole): boolean {
  return roleAtLeast(role, "reviewer");
}

export function canDeptApprove(role: DeptRole): boolean {
  return roleAtLeast(role, "approver");
}

/** Departments in `all` that the user is a member of, preserving `all`'s order. */
export function pickMemberDepartments(all: Department[], memberIds: ReadonlySet<string>): Department[] {
  return all.filter((department) => memberIds.has(department.id));
}
