"use client";

import { useEffect, useRef } from "react";
import { shouldRefreshOnReturn } from "@/domain/refresh-on-return";

/**
 * Runs `refresh` when the user comes back to this tab (focus / visibilitychange), coalesced
 * and throttled by shouldRefreshOnReturn. Never on mount -- the initial load owns that.
 * A rejected refresh is swallowed here: the caller keeps its current state and the next
 * return tries again. Callers should surface nothing for a background miss.
 */
export function useRefreshOnReturn(refresh: () => Promise<unknown>, enabled = true): void {
  const refreshRef = useRef(refresh);
  const inFlight = useRef(false);
  const lastRefreshAt = useRef(0);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;

    const onReturn = () => {
      const now = Date.now();
      const visible = document.visibilityState === "visible";
      if (!shouldRefreshOnReturn({ visible, inFlight: inFlight.current, lastRefreshAt: lastRefreshAt.current, now })) {
        return;
      }
      inFlight.current = true;
      lastRefreshAt.current = now;
      void refreshRef
        .current()
        .catch(() => undefined)
        .finally(() => {
          inFlight.current = false;
        });
    };

    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [enabled]);
}
