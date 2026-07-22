"use client";

import { useParams } from "next/navigation";
import { WorkOrderDetail } from "@/components/planning/work-order-detail";

/** Auth, workspace and the access gate come from `app/planning/layout.tsx`. */
export default function WorkOrderDetailPage() {
  const params = useParams<{ id: string }>();

  return <WorkOrderDetail workOrderId={params.id ?? ""} />;
}
