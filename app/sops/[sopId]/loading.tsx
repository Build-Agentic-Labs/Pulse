"use client";

import { useSearchParams } from "next/navigation";
import { SopDetailLoadingState } from "@/components/sop/sop-detail-loading-state";
import type { SopEditorInitialView } from "@/components/sop/sop-editor";

export default function SopDetailLoading() {
  const searchParams = useSearchParams();
  const step = searchParams.get("step");
  const initialView: SopEditorInitialView | undefined =
    step === "draft-review" || step === "final-approval" || step === "quality-approval"
      ? step
      : undefined;

  return <SopDetailLoadingState initialView={initialView} />;
}
