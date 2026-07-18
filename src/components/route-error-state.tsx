"use client";

import { RefreshCw } from "lucide-react";

export function RouteErrorState({
  title = "This workspace could not load",
  reset,
}: {
  title?: string;
  reset: () => void;
}) {
  return (
    <main className="flex h-full min-h-[360px] w-full items-center justify-center bg-canvas px-6">
      <section className="w-full max-w-md border-y border-line py-6">
        <p className="ui-mono-label text-danger">Needs attention</p>
        <h1 className="mt-2 text-xl font-semibold text-ink">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
          Retry the request. Your saved workspace data is not changed by this error.
        </p>
        <button type="button" className="ui-btn-primary mt-5 gap-2" onClick={reset}>
          <RefreshCw size={15} />
          Retry
        </button>
      </section>
    </main>
  );
}
