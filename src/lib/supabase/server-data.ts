import { cookies } from "next/headers";
import {
  fetchOrgToolAccess,
  loadPlannerStateFromSupabase,
  loadWorkspaceProjectGroups,
} from "@/domain/supabase-planner";
import type { AccessLevel, PlannerState, WorkspaceProjectGroup } from "@/domain/types";
import { SOP_WORKSPACE_COOKIE } from "@/lib/sop/workspace-cookie";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type InitialSopWorkspaceData = {
  groups: WorkspaceProjectGroup[];
  orgToolAccess: AccessLevel;
  workspaceId?: string;
};

/**
 * Server-side first paint for the workspace shell (refactor plan, Stage 5): the
 * READ half of what AuthProjectGate does on mount, fetched with the caller's
 * cookie session so the shell renders real workspace/project data from the
 * document instead of a loading shell.
 *
 * Deliberately read-only: the gate's bootstrap WRITES (profile upsert + grant
 * redemption in ensureDefaultWorkspaceMembership) stay client-side — mutating
 * during an RSC render is unsafe (prefetches and streaming retries multi-fire),
 * exactly the hazard the refactor plan flags. New users whose memberships have
 * not been minted yet simply get an empty read here; the client bootstrap mints
 * them and its background refresh fills the shell in.
 *
 * Every failure path returns undefined and the shell behaves exactly as before.
 */
export async function fetchInitialWorkspaceGroups(): Promise<WorkspaceProjectGroup[] | undefined> {
  try {
    const supabase = await createSupabaseServerClient();
    // getUser(), not getSession(): the cookie payload is unverified input on the
    // server, and this fetch is the request's verification point.
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      return undefined;
    }
    return await loadWorkspaceProjectGroups(data.user.id, supabase);
  } catch {
    return undefined;
  }
}

/**
 * Server-side first paint for the SOP provider. Unlike its generic loading
 * fallback, this data is enough to render the final navigation immediately:
 * workspace role controls the Manage section, org-tool access controls author
 * actions, and the validated cookie keeps the selected workspace stable.
 *
 * The client provider still revalidates in the background and performs the
 * default-membership bootstrap when needed. This function remains read-only so
 * RSC retries and prefetches cannot create memberships.
 */
export async function fetchInitialSopWorkspaceData(): Promise<InitialSopWorkspaceData | undefined> {
  try {
    const [supabase, cookieStore] = await Promise.all([createSupabaseServerClient(), cookies()]);
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      return undefined;
    }

    const [groups, orgToolAccess] = await Promise.all([
      loadWorkspaceProjectGroups(data.user.id, supabase),
      fetchOrgToolAccess(supabase).catch(() => "none" as const),
    ]);
    const requestedWorkspaceId = cookieStore.get(SOP_WORKSPACE_COOKIE)?.value;
    const workspaceId =
      groups.find((group) => group.workspace.id === requestedWorkspaceId)?.workspace.id ??
      groups[0]?.workspace.id;

    return { groups, orgToolAccess, workspaceId };
  } catch {
    return undefined;
  }
}

/**
 * The planner route's combined first paint: workspace groups (shell) and the
 * project's planner state (Main scenario) in one pass — one session
 * verification, both reads in parallel under the caller's RLS scope. The state
 * is painted through the planner's cache path, so the destructive shell
 * autosave stays disabled until the client's own load confirms.
 */
export async function fetchInitialPlannerData(projectId: string): Promise<{
  groups?: WorkspaceProjectGroup[];
  plannerState?: PlannerState;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      return {};
    }
    const [groups, plannerState] = await Promise.all([
      loadWorkspaceProjectGroups(data.user.id, supabase).catch(() => undefined),
      loadPlannerStateFromSupabase(projectId, undefined, supabase).catch(() => undefined),
    ]);
    return { groups, plannerState: plannerState ?? undefined };
  } catch {
    return {};
  }
}
