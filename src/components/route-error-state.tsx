"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect } from "react";
import {
  claimRouteErrorReload,
  shouldReloadStaleRouteError,
  type RouteErrorLike,
} from "@/lib/route-error-recovery";

export function RouteErrorState({
  title = "This workspace could not load",
  reset,
  error,
  recoverStaleClient = false,
}: {
  title?: string;
  reset: () => void;
  error?: RouteErrorLike;
  recoverStaleClient?: boolean;
}) {
  const staleClientFailure = Boolean(
    recoverStaleClient &&
      error &&
      shouldReloadStaleRouteError(error, process.env.NODE_ENV),
  );

  useEffect(() => {
    if (!error) return;

    console.error("[Pulse route error]", {
      name: error.name,
      message: error.message,
      digest: error.digest,
      stack: "stack" in error ? error.stack : undefined,
    });

    if (
      !staleClientFailure ||
      !claimRouteErrorReload(window.sessionStorage, window.location.pathname)
    ) {
      return;
    }

    window.location.reload();
  }, [error, staleClientFailure]);

  const retry = useCallback(() => {
    if (staleClientFailure) {
      window.location.reload();
      return;
    }
    reset();
  }, [reset, staleClientFailure]);

  return (
    <main className="flex h-full min-h-[360px] w-full items-center justify-center bg-canvas px-6">
      <section className="w-full max-w-md border-y border-line py-6">
        <p className="ui-mono-label text-danger">Needs attention</p>
        <h1 className="mt-2 text-xl font-semibold text-ink">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
          Retry the request. Your saved workspace data is not changed by this error.
        </p>
        <button type="button" className="ui-btn-primary mt-5 gap-2" onClick={retry}>
          <RefreshCw size={15} />
          Retry
        </button>
      </section>
    </main>
  );
}
