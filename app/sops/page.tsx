import { cookies } from "next/headers";
import { Suspense } from "react";
import {
  SopWorkspace,
  SopWorkspaceLoadingState,
  type SopWorkspaceInitialData,
} from "@/components/sop/sop-workspace";
import { pickMemberDepartments } from "@/domain/departments";
import { loadMembersAccessForWorkspace } from "@/domain/supabase-planner";
import {
  fetchDepartmentRolesForUser,
  listDepartments,
  listMembersForDepartments,
} from "@/lib/departments/store";
import { listHistoricalRevisions } from "@/lib/sop/review";
import { fetchSopListReviewData } from "@/lib/sop/list-review-data";
import { fetchReviewQueueData } from "@/lib/sop/review-queue-data";
import { listSops } from "@/lib/sop/store";
import { SOP_WORKSPACE_COOKIE } from "@/lib/sop/workspace-cookie";
import { getServerAuthContext } from "@/lib/supabase/request-context";

export const metadata = {
  title: "SOPs | Pulse",
  description: "Create standardized SOPs and convert legacy documents.",
};

type ServerTab = "dashboard" | "all" | "review" | "library" | "retired" | "settings";

function parseServerTab(raw: string | string[] | undefined): ServerTab {
  return raw === "dashboard" || raw === "review" || raw === "library" || raw === "retired" || raw === "settings"
    ? raw
    : "all";
}

/**
 * Stage 5 (refactor plan): whichever SOP tab the URL addresses is fetched ON THE
 * SERVER with the caller's cookie session and arrives with the document,
 * replacing that tab's first client fetch. The workspace comes from the cookie
 * the provider mirrors; RLS scopes every read to the signed-in user, so a stale
 * or forged cookie yields empty data, never someone else's. Every failure path
 * simply omits the initial data and the page behaves exactly as before
 * (client-side fetch after hydration). The departments tab is manage-gated and
 * stays client-fetched.
 *
 * The provider is mounted once in app/sops/layout.tsx. SopWorkspace reads the
 * `?tab=` param via useSearchParams, which Next 15 requires inside Suspense.
 */
export default async function SopsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  let initial: SopWorkspaceInitialData | undefined;
  const params = await searchParams;
  const tab = parseServerTab(params.tab);

  try {
    const cookieStore = await cookies();
    const workspaceId = cookieStore.get(SOP_WORKSPACE_COOKIE)?.value;
    if (workspaceId) {
      const { supabase, user } = await getServerAuthContext();
      if (user) {
        switch (tab) {
          case "dashboard": {
            const [sops, departments] = await Promise.all([
              listSops(workspaceId, supabase),
              listDepartments(workspaceId, supabase),
            ]);
            initial = { tab, workspaceId, sops, departments };
            break;
          }
          case "all": {
            const [sops, departments, departmentRoles] = await Promise.all([
              listSops(workspaceId, supabase),
              listDepartments(workspaceId, supabase),
              fetchDepartmentRolesForUser(user.id, supabase),
            ]);
            const review = await fetchSopListReviewData(sops, user.id, supabase);
            const memberDepartments = pickMemberDepartments(
              departments,
              new Set(departmentRoles.keys()),
            );
            initial = { tab, workspaceId, sops, departments, memberDepartments, review };
            break;
          }
          case "library": {
            const [sops, departments] = await Promise.all([
              listSops(workspaceId, supabase),
              listDepartments(workspaceId, supabase),
            ]);
            initial = { tab, workspaceId, sops, departments };
            break;
          }
          case "retired": {
            const [sops, revisions] = await Promise.all([
              listSops(workspaceId, supabase),
              listHistoricalRevisions(workspaceId, supabase),
            ]);
            initial = { tab, workspaceId, sops, revisions };
            break;
          }
          case "review": {
            const queue = await fetchReviewQueueData(workspaceId, user.id, supabase);
            initial = { tab, workspaceId, queue };
            break;
          }
          case "settings": {
            const departments = await listDepartments(workspaceId, supabase);
            const [members, directory] = await Promise.all([
              listMembersForDepartments(departments.map((department) => department.id), supabase),
              loadMembersAccessForWorkspace(workspaceId, supabase),
            ]);
            initial = { tab, workspaceId, departments, members, directory };
            break;
          }
        }
      }
    }
  } catch {
    // No session, no cookie, or a fetch error: fall back to client-side loading.
  }

  return (
    <Suspense fallback={<SopWorkspaceLoadingState active={tab} />}>
      <SopWorkspace initial={initial} />
    </Suspense>
  );
}
