"use client";

import { useSearchParams } from "next/navigation";
import { SopDetailLoadingState } from "@/components/sop/sop-detail-loading-state";

export default function SopDetailLoading() {
  const params = useSearchParams();
  const step = params.get("step");
  const initialView = params.get("preview") === "pdf" ? "pdf" : step === "draft-review" || step === "final-approval" || step === "quality-approval" ? step : undefined;
  return <SopDetailLoadingState initialView={initialView} fromReviewQueue={params.get("via") === "review"} />;
}
