"use client";

import { useEffect, useState } from "react";
import { listJobTitles, type JobTitle } from "./store";

/** Refresh on return so every picker sees titles saved in other forms. */
export function useJobTitles(workspaceId?: string) {
  const [state, setState] = useState<{ workspaceId?: string; titles: JobTitle[]; error: string }>({ titles: [], error: "" });
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    const refresh = () => {
      void listJobTitles(workspaceId).then(
        (titles) => { if (active) setState({ workspaceId, titles, error: "" }); },
        () => { if (active) setState({ workspaceId, titles: [], error: "Saved job titles could not be loaded. Reopen this form to retry." }); },
      );
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); };
  }, [workspaceId]);
  return state.workspaceId === workspaceId ? state : { titles: [], error: "" };
}
