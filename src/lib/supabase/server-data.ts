import { loadWorkspaceProjectGroups } from "@/domain/supabase-planner";
import type { WorkspaceProjectGroup } from "@/domain/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
