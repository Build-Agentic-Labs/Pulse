// Planner access resolution: a project's context (organization, role, edit access), the per-client
// superadmin check (concurrent callers on one client share a request; settled results are never
// reused), per-project and Quality Module access levels, the access setters, and the audit log.
// Moved verbatim from supabase-planner.ts (Phase 5); the facade re-exports the public names.

import { getUserFromSession, plannerClient } from "./client";
import { isMissingRelationError, throwIfError } from "./query-helpers";
import { maybeText, normalizeAccessLevel } from "./row-mappers";
import type { AccessLevel, PlannerProjectContext, WorkspaceRole } from "@/domain/types";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function loadProjectContext(
  supabase: ReturnType<typeof plannerClient>,
  projectId: string,
): Promise<PlannerProjectContext> {
  const project = await throwIfError(supabase.from("projects").select("*").eq("id", projectId).maybeSingle());

  if (!project) {
    throw new Error("Workspace not found or you do not have access to it.");
  }

  const { data: userData } = await getUserFromSession(supabase);
  // All three reads depend on the project identity, but not on each other.
  // Await them together so a fresh planner load does not pay three consecutive
  // network round trips before it can confirm its editable graph. Keep the
  // non-manager project-access check below conditional, as before.
  const [workspace, member, superAdmin] = await Promise.all([
    throwIfError(supabase.from("workspaces").select("*").eq("id", project.workspace_id).maybeSingle()),
    userData.user
      ? throwIfError(
          supabase.from("workspace_members").select("role")
            .eq("workspace_id", project.workspace_id).eq("user_id", userData.user.id).maybeSingle(),
        )
      : Promise.resolve(null),
    fetchIsSuperAdmin(supabase),
  ]);

  if (!workspace) {
    throw new Error("Organization not found or you do not have access to it.");
  }

  const memberRole = member?.role ? (String(member.role) as WorkspaceRole) : undefined;
  // Workspace managers (and superadmins) see/edit every project they manage.
  const isManager = superAdmin || memberRole === "owner" || memberRole === "admin";

  let role: WorkspaceRole | undefined;
  let accessLevel: AccessLevel | undefined;

  if (isManager) {
    role = memberRole ?? "owner";
    accessLevel = "edit";
  } else {
    const level = userData.user
      ? await fetchProjectAccessLevel(supabase, String(project.id), userData.user.id)
      : undefined;
    if (level === undefined) {
      // Access model not available yet — fall back to legacy workspace role.
      role = memberRole;
    } else {
      accessLevel = level;
      // Reuse role-based edit gating: edit -> editor, view -> viewer, none -> no access.
      role = level === "edit" ? "editor" : level === "view" ? "viewer" : undefined;
    }
  }

  return {
    isAwiMaster: project.is_awi_master,
    projectId: String(project.id),
    projectName: String(project.name ?? ""),
    workspaceId: String(workspace.id),
    workspaceName: String(workspace.name ?? ""),
    role,
    accessLevel,
  };
}

const inflightSuperAdminChecks = new WeakMap<SupabaseClient, Promise<boolean>>();

// Whether the signed-in user is a platform superadmin. Concurrent workspace/access loads share
// one RPC per client, while later refreshes still perform a fresh permission check.
export function fetchIsSuperAdmin(
  supabase: ReturnType<typeof plannerClient> = plannerClient(),
): Promise<boolean> {
  const pending = inflightSuperAdminChecks.get(supabase);
  if (pending) {
    return pending;
  }

  const check = Promise.resolve(supabase.rpc("is_super_admin")).then(({ data, error }) => {
    if (error) {
      if (error.code === "PGRST202") {
        return false;
      }
      throw error;
    }
    return data === true;
  });
  const trackedCheck = check.finally(() => {
    if (inflightSuperAdminChecks.get(supabase) === trackedCheck) {
      inflightSuperAdminChecks.delete(supabase);
    }
  });
  inflightSuperAdminChecks.set(supabase, trackedCheck);
  return trackedCheck;
}

// The signed-in user's access level for a single project. Returns undefined when the
// project_access table doesn't exist yet (pre-migration) so callers can fall back to
// legacy role-based behavior.
async function fetchProjectAccessLevel(
  supabase: ReturnType<typeof plannerClient>,
  projectId: string,
  userId: string,
): Promise<AccessLevel | undefined> {
  const { data, error } = await supabase
    .from("project_access")
    .select("level")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingRelationError(error)) {
      return undefined;
    }
    throw error;
  }
  return normalizeAccessLevel(data?.level);
}

// The signed-in user's full project-access map (projectId -> level). Returns undefined when
// the project_access table doesn't exist yet (pre-migration) so callers skip filtering.
export async function fetchUserProjectAccessMap(
  supabase: ReturnType<typeof plannerClient>,
  userId: string,
): Promise<Map<string, AccessLevel> | undefined> {
  try {
    const data = await readAllPages(async (from, to) => {
      const result = await supabase.from("project_access").select("project_id, level")
        .eq("user_id", userId).order("project_id").range(from, to);
      if (result.error) throw result.error;
      return result.data;
    });
    return new Map(data.map((row) => [String(row.project_id), normalizeAccessLevel(row.level)]));
  } catch (error) {
    if (isMissingRelationError(error as { code?: string })) {
      return undefined;
    }
    throw error;
  }
}

// The signed-in user's Quality Module access level ("edit" for superadmins).
export async function fetchOrgToolAccess(
  workspaceId: string,
  supabase: ReturnType<typeof plannerClient> = plannerClient(),
): Promise<AccessLevel> {
  const [isSuperAdmin, { data: userData }] = await Promise.all([
    fetchIsSuperAdmin(supabase),
    getUserFromSession(supabase),
  ]);
  if (isSuperAdmin) {
    return "edit";
  }
  if (!userData.user) {
    return "none";
  }
  const { data, error } = await supabase
    .from("org_tool_access")
    .select("level")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (error) {
    if (isMissingRelationError(error)) {
      return "none";
    }
    throw error;
  }
  const level = data?.level ? String(data.level) : "none";
  return level === "edit" || level === "view" ? (level as AccessLevel) : "none";
}

// One row from the audit_log table (written by DB triggers on the access tables).
export interface AuditLogEntry {
  id: number;
  workspaceId?: string;
  actorId?: string;
  actorEmail?: string;
  action: string;
  targetType: string;
  targetId?: string;
  details?: { old?: Record<string, unknown>; new?: Record<string, unknown> };
  createdAt: string;
}

/**
 * Workspace activity, newest first. Managers/superadmins see rows via the
 * "audit_log manager read" policy; other callers just get zero rows back.
 * Organization-scoped entries plus global platform-admin entries are included.
 */
export async function loadAuditLogFromSupabase(
  workspaceId: string,
  options: { beforeId?: number; limit?: number } = {},
): Promise<AuditLogEntry[]> {
  const supabase = plannerClient();
  let query = supabase
    .from("audit_log")
    .select("*")
    .or(`workspace_id.eq.${workspaceId},workspace_id.is.null`)
    .order("id", { ascending: false })
    .limit(options.limit ?? 30);
  if (options.beforeId !== undefined) {
    query = query.lt("id", options.beforeId);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: Number(row.id),
    workspaceId: maybeText(row.workspace_id),
    actorId: maybeText(row.actor_id),
    actorEmail: maybeText(row.actor_email),
    action: String(row.action ?? ""),
    targetType: String(row.target_type ?? ""),
    targetId: maybeText(row.target_id),
    details: row.details && typeof row.details === "object" ? (row.details as AuditLogEntry["details"]) : undefined,
    createdAt: String(row.created_at),
  }));
}

export async function setProjectAccessInSupabase(
  projectId: string,
  userId: string,
  level: AccessLevel,
): Promise<void> {
  const supabase = plannerClient();
  const { data: userData } = await getUserFromSession(supabase);
  await throwIfError(
    supabase.from("project_access").upsert(
      { project_id: projectId, user_id: userId, level, granted_by: userData.user?.id ?? null },
      { onConflict: "project_id,user_id" },
    ),
  );
}

export async function setOrgToolAccessInSupabase(
  workspaceId: string,
  userId: string,
  level: AccessLevel,
): Promise<void> {
  const supabase = plannerClient();
  const { data: userData } = await getUserFromSession(supabase);
  await throwIfError(
    supabase.from("org_tool_access").upsert(
      { workspace_id: workspaceId, user_id: userId, level, granted_by: userData.user?.id ?? null },
      { onConflict: "workspace_id,user_id" },
    ),
  );
}
