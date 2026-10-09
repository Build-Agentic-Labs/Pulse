"use client";

import { useEffect, useMemo } from "react";
import { createCoalescedRefresh, type RefreshOptions } from "./coalesced-refresh";

/** Pass a useCallback scoped to the current workspace/document. */
export function useCoalescedRefresh<T>(
  read: (options: RefreshOptions, isCurrent: () => boolean) => Promise<T>,
) {
  const refresh = useMemo(() => createCoalescedRefresh<T>(read), [read]);
  useEffect(() => () => refresh.cancel(), [refresh]);
  return refresh.run;
}
