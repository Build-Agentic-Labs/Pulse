import type { SupabaseClient } from "@supabase/supabase-js";
import type { Department } from "@/domain/departments";
import type { Database } from "@/lib/database.types";
import { listDepartments, fetchDepartmentRolesForUser } from "@/lib/departments/store";

export type WiLibraryDepartments = {
  departments: Department[];
  memberDepartmentIds: string[];
};

/** Same membership data for the server's first paint and subsequent client refreshes. */
export async function loadWiLibraryDepartments(
  workspaceId: string,
  userId: string,
  client?: SupabaseClient<Database>,
): Promise<WiLibraryDepartments> {
  const [departments, roles] = await Promise.all([
    listDepartments(workspaceId, client),
    fetchDepartmentRolesForUser(userId, client),
  ]);
  return {
    departments,
    memberDepartmentIds: departments.filter(d => roles.has(d.id)).map(d => d.id),
  };
}
