"use client";

import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SopDetailLoadingSurface } from "./sop-detail-loading-surface";

/** Outer boundaries can suspend before the workspace provider exists. */
export function SopRouteLoadingState({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  if (!/^\/sops\/[^/]+\/?$/.test(pathname ?? "") || pathname === "/sops/new" || pathname === "/sops/problem-solving") {
    return children;
  }
  const step = params.get("step");
  const initialView = params.get("preview") === "pdf" ? "pdf" : step === "draft-review" || step === "final-approval" || step === "quality-approval" ? step : undefined;
  return <SopDetailLoadingSurface initialView={initialView} fromReviewQueue={params.get("via") === "review"} />;
}
