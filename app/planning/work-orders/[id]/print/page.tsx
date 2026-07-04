"use client";

import { useParams } from "next/navigation";
import { PlanningRoute } from "@/components/planning/planning-route";
import { WorkOrderPrintPreview } from "@/components/planning/work-order-print";

export default function WorkOrderPrintPage() {
  const params = useParams<{ id: string }>();

  return (
    <PlanningRoute>
      <WorkOrderPrintPreview workOrderId={params.id ?? ""} />
    </PlanningRoute>
  );
}
