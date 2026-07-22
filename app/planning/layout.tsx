import type { ReactNode } from "react";
import { PlanningNav } from "@/components/planning/planning-nav";
import { PlanningRoute } from "@/components/planning/planning-route";
import { fetchInitialWorkspaceGroups } from "@/lib/supabase/server-data";

export const metadata = {
  title: "Planning | Pulse",
  description: "Production schedule, work orders and product configuration.",
};

/**
 * One shell for the whole Planning space. Mounting the provider and the sidebar HERE rather than
 * per page means auth + workspace load ONCE and stay mounted while the planner moves between
 * Sales orders, Work orders and Product configuration -- no gate re-run, no sidebar flash. Same
 * fix `app/sops/layout.tsx` made for Quality.
 *
 * This is a server component: it performs the first-paint fetch, and `children` stay server
 * components even though `PlanningRoute` is a client component. A client component may receive
 * server-rendered children as props -- they arrive as already-rendered payload and are never
 * "run" by the client boundary.
 *
 * The header is deliberately NOT spanned across the top (unlike SopShell): each page owns its
 * own header via `PlanningShell` because the work-order detail needs its own back arrow, wide
 * mode and action buttons, and hoisting the header would force a slot mechanism to pass those
 * from page up to layout.
 */
export default async function PlanningLayout({ children }: { children: ReactNode }) {
  return (
    <PlanningRoute initialGroups={await fetchInitialWorkspaceGroups()}>
      <div className="flex h-[100dvh] overflow-hidden bg-canvas text-ink">
        {/* `ui-nav-sidebar` is desktop-only (hidden below lg). Planning is a desktop workflow --
            it starts with an Excel upload -- so small screens get the pages without the nav. */}
        <aside className="ui-nav-sidebar shrink-0 flex-col overflow-hidden">
          <nav className="flex min-h-0 flex-1 flex-col overflow-auto px-2 py-3">
            <PlanningNav />
          </nav>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </PlanningRoute>
  );
}
