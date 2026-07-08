/**
 * Supabase-backed persistence for departments and their membership. RLS is the gate
 * (managers write, org-tool-view reads); this layer only shapes rows ↔ domain types,
 * mirroring the SOP/planner stores (exact column lists, `throwIfError`).
 */

import type { Department, DepartmentMember, DeptRole } from "@/domain/departments";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";

const DEPT_COLUMNS = "id, workspace_id, code, name, is_quality_gate";
const MEMBER_COLUMNS = "department_id, user_id, dept_role";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `dept_${Date.now().toString(36)}`;
}

async function throwIfError<T>(
  operation: PromiseLike<{ data: T; error: { message: string; code?: string } | null }>,
): Promise<T> {
  const { data, error } = await operation;
  if (error) {
    if (error.code === "23505" && !error.message.includes("pkey")) {
      throw new Error("A department with this code already exists in this organization.");
    }
    throw new Error(error.message);
  }
  return data;
}

function mapDepartment(row: Record<string, unknown>): Department {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    isQualityGate: Boolean(row.is_quality_gate),
  };
}

function mapMember(row: Record<string, unknown>): DepartmentMember {
  return {
    departmentId: String(row.department_id),
    userId: String(row.user_id),
    deptRole: (row.dept_role as DeptRole | null) ?? "author",
  };
}

export async function listDepartments(workspaceId: string): Promise<Department[]> {
  const supabase = createPlannerSupabaseClient();
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

/** Insert or update a department. The DB enforces code-uniqueness and one-quality-gate. */
export async function saveDepartment(workspaceId: string, input: DepartmentInput): Promise<Department> {
  const supabase = createPlannerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? null;
  const row = {
    id: input.id ?? newId(),
    workspace_id: workspaceId,
    code: input.code.trim(),
    name: input.name.trim(),
    is_quality_gate: input.isQualityGate,
    updated_by: userId,
    ...(input.id ? {} : { created_by: userId }),
  };
  const saved = await throwIfError(
    supabase.from("departments").upsert(row).select(DEPT_COLUMNS).single(),
  );
  return mapDepartment(saved as Record<string, unknown>);
}

export async function deleteDepartment(id: string): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  await throwIfError(supabase.from("departments").delete().eq("id", id));
}

export async function listMembers(departmentId: string): Promise<DepartmentMember[]> {
  const supabase = createPlannerSupabaseClient();
  const rows = await throwIfError(
    supabase.from("department_members").select(MEMBER_COLUMNS).eq("department_id", departmentId),
  );
  return (rows ?? []).map(mapMember);
}

export async function setMember(departmentId: string, userId: string, role: DeptRole): Promise<void> {
  const supabase = createPlannerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  await throwIfError(
    supabase
      .from("department_members")
      .upsert({ department_id: departmentId, user_id: userId, dept_role: role, granted_by: userData.user?.id ?? null })
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
export async function fetchMyDeptRoles(workspaceId: string): Promise<Map<string, DeptRole>> {
  const supabase = createPlannerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return new Map();
  const depts = await listDepartments(workspaceId);
  const deptIds = new Set(depts.map((d) => d.id));
  const rows = await throwIfError(
    supabase.from("department_members").select(MEMBER_COLUMNS).eq("user_id", userId),
  );
  const roles = new Map<string, DeptRole>();
  for (const row of rows ?? []) {
    const m = mapMember(row);
    if (deptIds.has(m.departmentId)) roles.set(m.departmentId, m.deptRole);
  }
  return roles;
}
