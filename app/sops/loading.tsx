import { SopWorkspaceLoadingState } from "@/components/sop/sop-workspace";
import { SopRouteLoadingState } from "@/components/sop/sop-route-loading-state";

export default function Loading() {
  return <SopRouteLoadingState><SopWorkspaceLoadingState /></SopRouteLoadingState>;
}
