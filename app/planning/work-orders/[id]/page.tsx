"use client";

import { useParams } from "next/navigation";
import { PlanningRoute } from "@/components/planning/planning-route";
import { WorkOrderDetail } from "@/components/planning/work-order-detail";

export default function WorkOrderDetailPage() {
  const params = useParams<{ id: string }>();

  return (
    <PlanningRoute>
      <WorkOrderDetail workOrderId={params.id ?? ""} />
    </PlanningRoute>
  );
}
