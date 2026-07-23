import type { ReactNode } from "react";
import { PlanningNav } from "@/components/planning/planning-nav";
import { PlanningRoute } from "@/components/planning/planning-route";
import { fetchInitialWorkspaceGroups } from "@/lib/supabase/server-data";

export const metadata = {
  title: "Planning | Pulse",
  description: "Production schedule, work orders and product configuration.",
};

/**
 * One shell for the Planning WORKSPACE routes. Mounting the provider and the sidebar HERE rather
 * than per page means auth + workspace load ONCE and stay mounted while the planner moves between
 * Sales orders, Work orders and Product configuration -- no gate re-run, no sidebar flash. Same
 * fix `app/sops/layout.tsx` made for Quality.
 *
 * WHY THE `(workspace)` ROUTE GROUP: the print routes (`/planning/print` and
 * `/planning/work-orders/[id]/print`) deliberately sit OUTSIDE it. They are documents, not
 * screens -- a fixed `h-[100dvh] overflow-hidden` ancestor clips printed output to the first
 * page, which is exactly what `work-order-print.tsx`'s `.wo-print-scroll` reset exists to
 * prevent, and a sidebar would land on the paper in landscape. The group keeps this chrome off
 * them entirely instead of relying on print-media overrides to undo it. They keep their own
 * `PlanningRoute` gate.
 *
 * This is a server component: it performs the first-paint fetch, and `children` stay server
 * components even though `PlanningRoute` is a client component. A client component may receive
 * server-rendered children as props -- they arrive as already-rendered payload and are never
 * "run" by the client boundary.
 *
 * Each page still owns its header via `PlanningShell` because work-order detail needs its own
 * back arrow and actions. `PlanningShell` fixes that header across the viewport; the sidebar and
 * page column both reserve the same 48px top row so Planning matches the shared workspace shell.
 */
export default async function PlanningLayout({ children }: { children: ReactNode }) {
  return (
    <PlanningRoute initialGroups={await fetchInitialWorkspaceGroups()}>
      <div className="flex h-[100dvh] overflow-hidden bg-surface text-ink">
        {/* `ui-nav-sidebar` is desktop-only (hidden below lg). Planning is a desktop workflow --
            it starts with an Excel upload -- so small screens get the pages without the nav. */}
        <aside className="ui-nav-sidebar shrink-0 flex-col overflow-hidden pt-12">
          <nav className="flex min-h-0 flex-1 flex-col overflow-auto px-2 py-3">
            <PlanningNav />
          </nav>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </PlanningRoute>
  );
}
