"use client";

import { RouteErrorState } from "@/components/route-error-state";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteErrorState reset={reset} />;
}
