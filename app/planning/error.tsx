"use client";

import { RouteErrorState } from "@/components/route-error-state";

export default function PlanningError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteErrorState title="Planning could not load" reset={reset} />;
}
