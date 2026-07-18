"use client";

import { RouteErrorState } from "@/components/route-error-state";

export default function SopsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteErrorState title="The SOP workspace could not load" reset={reset} />;
}
