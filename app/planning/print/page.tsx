"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { NothingLoadingBlock } from "@/components/nothing-ui";
import { PlanningRoute } from "@/components/planning/planning-route";
import { BatchPrintPreview } from "@/components/planning/work-order-print";

function BatchPrintPageBody() {
  const searchParams = useSearchParams();
  const ids = (searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");

  return (
    <PlanningRoute>
      <BatchPrintPreview ids={ids} />
    </PlanningRoute>
  );
}

export default function BatchPrintPage() {
  return (
    <Suspense fallback={<NothingLoadingBlock title="Loading" />}>
      <BatchPrintPageBody />
    </Suspense>
  );
}
