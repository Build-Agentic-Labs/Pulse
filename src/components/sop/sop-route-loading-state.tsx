"use client";

import { Suspense, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SopDetailLoadingSurface } from "./sop-detail-loading-surface";
import { WiRouteLoadingState } from "@/components/quality-wi/wi-route-loading-state";

/** Outer boundaries can suspend before the workspace provider exists. */
function RouteLoadingSurface({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  if (pathname === "/sops/work-instructions" || pathname?.startsWith("/sops/work-instructions/")) {
    return <WiRouteLoadingState />;
  }
  if (!/^\/sops\/[^/]+\/?$/.test(pathname ?? "") || pathname === "/sops/new" || pathname === "/sops/problem-solving") {
    return children;
  }
  const step = params.get("step");
  const initialView = params.get("preview") === "pdf" ? "pdf" : step === "draft-review" || step === "final-approval" || step === "quality-approval" ? step : undefined;
  return <SopDetailLoadingSurface initialView={initialView} fromReviewQueue={params.get("via") === "review"} />;
}

export function SopRouteLoadingState({ children }: { children: ReactNode }) {
  return <Suspense fallback={children}><RouteLoadingSurface>{children}</RouteLoadingSurface></Suspense>;
}
