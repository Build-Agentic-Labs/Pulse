import { DashboardLoadingState } from "@/components/space-loading-states";

/** Dashboard-only fallback. The route group keeps it out of sibling spaces. */
export default function Loading() {
  return <DashboardLoadingState />;
}
