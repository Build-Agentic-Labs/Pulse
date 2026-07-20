import { cookies } from "next/headers";
import { Suspense } from "react";
import { QualityLoadingState } from "@/components/space-loading-states";
import { SopWorkspace, type SopWorkspaceInitialData } from "@/components/sop/sop-workspace";
import { listDepartments } from "@/lib/departments/store";
import { listHistoricalRevisions } from "@/lib/sop/review";
import { fetchReviewQueueData } from "@/lib/sop/review-queue-data";
import { listSops } from "@/lib/sop/store";
import { SOP_WORKSPACE_COOKIE } from "@/lib/sop/workspace-cookie";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "SOPs | Pulse",
  description: "Create standardized SOPs and convert legacy documents.",
};

type ServerTab = "all" | "review" | "library" | "retired";

function parseServerTab(raw: string | string[] | undefined): ServerTab {
  return raw === "review" || raw === "library" || raw === "retired" ? raw : "all";
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

  try {
    const [cookieStore, params] = await Promise.all([cookies(), searchParams]);
    const workspaceId = cookieStore.get(SOP_WORKSPACE_COOKIE)?.value;
    if (workspaceId) {
      const supabase = await createSupabaseServerClient();
      // getUser(), not getSession(): on the server the cookie payload is
      // unverified input, and this page is the request's verification point.
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        const tab = parseServerTab(params.tab);
        switch (tab) {
          case "all": {
            const sops = await listSops(workspaceId, supabase);
            initial = { tab, workspaceId, sops };
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
            const queue = await fetchReviewQueueData(workspaceId, data.user.id, supabase);
            initial = { tab, workspaceId, queue };
            break;
          }
        }
      }
    }
  } catch {
    // No session, no cookie, or a fetch error: fall back to client-side loading.
  }

  return (
    <Suspense fallback={<QualityLoadingState />}>
      <SopWorkspace initial={initial} />
    </Suspense>
  );
}
