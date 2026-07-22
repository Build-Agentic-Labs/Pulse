import { PlanningRouteShell } from "@/components/project-route-shells";

export const metadata = {
  title: "Work orders | Pulse",
};

/**
 * The work-order board, and the Planning space root. Kept at `/planning` rather than moved to
 * `/planning/work-orders` so existing links, print routes and bookmarks keep working.
 *
 * The workspace fetch that used to live here moved to `app/planning/layout.tsx`, which performs
 * it once for every route in the space.
 */
export default function PlanningPage() {
  return <PlanningRouteShell />;
}
