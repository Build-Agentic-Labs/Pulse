/**
 * Supabase-backed persistence for departments and their membership. RLS is the gate
 * (managers write, org-tool-view reads); this layer only shapes rows ↔ domain types,
 * mirroring the SOP/planner stores (exact column lists, `throwIfError`).
 */

import type { Department, DepartmentMember, DeptRole } from "@/domain/departments";
import { pickMemberDepartments } from "@/domain/departments";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPlannerSupabaseClient, getUserFromSession } from "@/domain/supabase-planner";
import type { Database } from "@/lib/database.types";
import { throwIfError as throwIfSupabaseError, type SupabaseResultError } from "@/lib/supabase-errors";

const DEPT_COLUMNS = "id, workspace_id, code, name, is_quality_gate, sop_target";
const MEMBER_COLUMNS = "department_id, user_id, dept_role, position_title";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `dept_${Date.now().toString(36)}`;
}

function departmentConstraintMessage(error: SupabaseResultError): string | undefined {
  if (error.code === "23505" && error.message.includes("quality_gate")) {
    return "Only one Quality department is allowed per organization.";
  }
  if (error.code === "23505" && !error.message.includes("pkey")) {
    return "A department with this code already exists in this organization.";
  }
  if (error.code === "23503") {
    return "This department still owns SOPs — reassign or retire them before deleting it.";
  }
  return undefined;
}

function throwIfError<T>(operation: PromiseLike<{ data: T; error: SupabaseResultError | null }>): Promise<T> {
  return throwIfSupabaseError(operation, departmentConstraintMessage);
}

function mapDepartment(row: Record<string, unknown>): Department {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    isQualityGate: Boolean(row.is_quality_gate),
    sopTarget: Number(row.sop_target ?? 0),
  };
}

function mapMember(row: Record<string, unknown>): DepartmentMember {
  return {
    departmentId: String(row.department_id),
    userId: String(row.user_id),
    deptRole: (row.dept_role as DeptRole | null) ?? "author",
    positionTitle: String(row.position_title ?? ""),
  };
}

export async function listDepartments(
  workspaceId: string,
  client?: SupabaseClient<Database>,
): Promise<Department[]> {
  const supabase = client ?? createPlannerSupabaseClient();
  const rows = await throwIfError(
    supabase.from("departments").select(DEPT_COLUMNS).eq("workspace_id", workspaceId).order("code"),
  );
  return (rows ?? []).map(mapDepartment);
}

export interface DepartmentInput {
  id?: string;
  code: string;
  name: string;
  isQualityGate: boolean;
}

/**
 * Insert or update a department. The DB enforces code-uniqueness and one-quality-gate. `code` is
 * immutable once set (it drives TYPE-DEPT-NNN numbering), so updates change only name + gate.
 */
export async function saveDepartment(workspaceId: string, input: DepartmentInput): Promise<Department> {
  const supabase = createPlannerSupabaseClient();
  const { data: userData } = await getUserFromSession(supabase);
  const userId = userData.user?.id ?? null;

  if (input.id) {
    const saved = await throwIfError(
      supabase
        .from("departments")
        .update({ name: input.name.trim(), is_quality_gate: input.isQualityGate, updated_by: userId })
        .eq("id", input.id)
        .select(DEPT_COLUMNS)
        .single(),
    );
    return mapDepartment(saved as Record<string, unknown>);
  }

  const saved = await throwIfError(
    supabase
      .from("departments")
      .insert({
        id: newId(),
        workspace_id: workspaceId,
        code: input.code.trim(),
        name: input.name.trim(),
        is_quality_gate: input.isQualityGate,
        created_by: userId,
        updated_by: userId,
      })
      .select(DEPT_COLUMNS)
      .single(),
  );
  return mapDepartment(saved as Record<string, unknown>);
}

export async function deleteDepartment(id: string): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  await throwIfError(supabase.from("departments").delete().eq("id", id));
}

/** Granular target write; department RLS restricts it to workspace owners/admins. */
export async function setDepartmentSopTarget(id: string, sopTarget: number): Promise<Department> {
  const supabase = createPlannerSupabaseClient();
  const { data: userData } = await getUserFromSession(supabase);
  const saved = await throwIfError(
    supabase
      .from("departments")
      .update({ sop_target: sopTarget, updated_by: userData.user?.id ?? null })
      .eq("id", id)
      .select(DEPT_COLUMNS)
      .single(),
  );
  return mapDepartment(saved as Record<string, unknown>);
}

export async function listMembers(departmentId: string): Promise<DepartmentMember[]> {
  const supabase = createPlannerSupabaseClient();
  const rows = await throwIfError(
    supabase.from("department_members").select(MEMBER_COLUMNS).eq("department_id", departmentId),
  );
  return (rows ?? []).map(mapMember);
}

/** Load the complete roster for a department list in one request. */
export async function listMembersForDepartments(
  departmentIds: readonly string[],
  client?: SupabaseClient<Database>,
): Promise<DepartmentMember[]> {
  const ids = [...new Set(departmentIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const supabase = client ?? createPlannerSupabaseClient();
  const rows = await throwIfError(
    supabase.from("department_members").select(MEMBER_COLUMNS).in("department_id", ids),
  );
  return (rows ?? []).map(mapMember);
}

export async function setMember(departmentId: string, userId: string, role: DeptRole): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  const { data: userData } = await getUserFromSession(supabase);
  await throwIfError(
    supabase
      .from("department_members")
      .upsert({ department_id: departmentId, user_id: userId, dept_role: role, granted_by: userData.user?.id ?? null })
      .select(MEMBER_COLUMNS)
      .single(),
  );
}

export async function setMemberPosition(
  departmentId: string,
  userId: string,
  positionTitle: string,
): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  await throwIfError(
    supabase
      .from("department_members")
      .update({ position_title: positionTitle.trim() })
      .eq("department_id", departmentId)
      .eq("user_id", userId)
      .select(MEMBER_COLUMNS)
      .single(),
  );
}

export async function removeMember(departmentId: string, userId: string): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  await throwIfError(
    supabase.from("department_members").delete().eq("department_id", departmentId).eq("user_id", userId),
  );
}

/** My department roles across the workspace — powers UI enable/disable (DB still enforces). */
export async function fetchMyDeptRoles(
  workspaceId: string,
  client?: SupabaseClient<Database>,
): Promise<Map<string, DeptRole>> {
  const supabase = client ?? createPlannerSupabaseClient();
  const { data: userData } = await getUserFromSession(supabase);
  const userId = userData.user?.id;
  if (!userId) return new Map();
  const [depts, roles] = await Promise.all([
    listDepartments(workspaceId, supabase),
    fetchDepartmentRolesForUser(userId, supabase),
  ]);
  const deptIds = new Set(depts.map((d) => d.id));
  return new Map([...roles].filter(([departmentId]) => deptIds.has(departmentId)));
}

/** All explicit department roles for one user. Callers may filter these to a workspace. */
export async function fetchDepartmentRolesForUser(
  userId: string,
  client?: SupabaseClient<Database>,
): Promise<Map<string, DeptRole>> {
  const supabase = client ?? createPlannerSupabaseClient();
  const rows = await throwIfError(
    supabase.from("department_members").select(MEMBER_COLUMNS).eq("user_id", userId),
  );
  const roles = new Map<string, DeptRole>();
  for (const row of rows ?? []) {
    const m = mapMember(row);
    roles.set(m.departmentId, m.deptRole);
  }
  return roles;
}

/**
 * The departments the current user is an explicit member of (author/reviewer/approver), for the
 * builder's owning-department picker. Managers are intentionally NOT folded in here (unlike the DB
 * `has_department_role`): authoring requires real membership, so a manager with no department is
 * blocked from creating SOPs until added to one.
 */
export async function listMyDepartments(
  workspaceId: string,
  client?: SupabaseClient<Database>,
  knownUserId?: string,
): Promise<Department[]> {
  const supabase = client ?? createPlannerSupabaseClient();
  const userId = knownUserId ?? (await getUserFromSession(supabase)).data.user?.id;
  if (!userId) return [];
  const [departments, roles] = await Promise.all([
    listDepartments(workspaceId, supabase),
    fetchDepartmentRolesForUser(userId, supabase),
  ]);
  const memberIds = new Set(roles.keys());
  return pickMemberDepartments(departments, memberIds);
}
