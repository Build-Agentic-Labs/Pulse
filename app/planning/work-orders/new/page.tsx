import { PlanningRoute } from "@/components/planning/planning-route";
import { WorkOrderNew } from "@/components/planning/work-order-new";

export const metadata = {
  title: "New work order | Pulse",
};

export default function NewWorkOrderPage() {
  return (
    <PlanningRoute>
      <WorkOrderNew />
    </PlanningRoute>
  );
}
