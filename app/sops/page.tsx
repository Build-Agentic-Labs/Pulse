import { cookies } from "next/headers";
import { Suspense } from "react";
import { AppLoadingShell } from "@/components/app-flow-panels";
import { SopWorkspace } from "@/components/sop/sop-workspace";
import { SOP_WORKSPACE_COOKIE } from "@/lib/sop/workspace-cookie";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listSops, type SopListItem } from "@/lib/sop/store";

export const metadata = {
  title: "SOPs | Pulse",
  description: "Create standardized SOPs and convert legacy documents.",
};

/**
 * Stage 5 pilot (refactor plan): the SOP list is fetched ON THE SERVER with the
 * caller's cookie session and arrives with the document, replacing the client's
 * first fetch round-trip. The workspace comes from the cookie the provider
 * mirrors; RLS scopes the read to the signed-in user, so a stale or forged
 * cookie yields an empty list, never someone else's data. Every failure path
 * simply omits the initial data and the page behaves exactly as before
 * (client-side fetch after hydration).
 *
 * The provider is mounted once in app/sops/layout.tsx. SopWorkspace reads the
 * `?tab=` param via useSearchParams, which Next 15 requires inside Suspense.
 */
export default async function SopsPage() {
  let initialSops: SopListItem[] | undefined;
  let initialWorkspaceId: string | undefined;

  try {
    const cookieStore = await cookies();
    const workspaceId = cookieStore.get(SOP_WORKSPACE_COOKIE)?.value;
    if (workspaceId) {
      const supabase = await createSupabaseServerClient();
      // getUser(), not getSession(): on the server the cookie payload is
      // unverified input, and this page is the request's verification point.
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        initialSops = await listSops(workspaceId, supabase);
        initialWorkspaceId = workspaceId;
      }
    }
  } catch {
    // No session, no cookie, or a fetch error: fall back to client-side loading.
  }

  return (
    <Suspense fallback={<AppLoadingShell title="Loading SOPs" />}>
      <SopWorkspace initialSops={initialSops} initialWorkspaceId={initialWorkspaceId} />
    </Suspense>
  );
}
