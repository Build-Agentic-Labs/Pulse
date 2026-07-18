"use client";

import { RouteErrorState } from "@/components/route-error-state";

export default function ProjectError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteErrorState title="The project workspace could not load" reset={reset} />;
}
