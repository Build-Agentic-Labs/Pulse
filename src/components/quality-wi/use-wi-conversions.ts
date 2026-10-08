"use client";
import { useCallback, useEffect, useState } from "react";
import type { ConversionJob } from "@/domain/quality-wi/conversion";
import { wiConversionRequest } from "@/lib/quality-wi/conversion-client";

/** Server-backed jobs survive navigation, refreshes and a different browser tab. */
export function useWiConversions(userId?: string | null, workspaceId?: string, enabled = true) {
  const scope = enabled && userId && workspaceId ? `${userId}:${workspaceId}` : null;
  const [state, setState] = useState<{ scope: string | null; jobs: ConversionJob[]; error: string }>({ scope: null, jobs: [], error: "" });
  const [revision, refresh] = useState(0);
  useEffect(() => {
    if (!scope || !userId || !workspaceId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let fetching = false;
    const controller = new AbortController();
    const read = async () => {
      if (fetching || stopped) return;
      fetching = true;
      let delay = 15000;
      try {
        const jobs = await wiConversionRequest<ConversionJob[]>(userId, `/api/quality-wi/convert?workspaceId=${encodeURIComponent(workspaceId)}`, undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]));
        if (!stopped) {
          setState(old => ({ scope, error: "", jobs: [...jobs, ...(old.scope === scope ? old.jobs.filter(job => Date.now() - Date.parse(job.createdAt) < 15000 && !jobs.some(item => item.id === job.id)) : [])] }));
          if (jobs.some(job => job.status === "processing")) delay = 4000;
        }
      } catch (error) {
        if (!stopped) setState(old => ({ scope, jobs: old.scope === scope ? old.jobs : [], error: error instanceof Error ? error.message : "Could not check conversions." }));
      } finally {
        fetching = false;
        if (!stopped) timer = setTimeout(read, delay);
      }
    };
    const onFocus = () => { clearTimeout(timer); void read(); };
    void read();
    window.addEventListener("focus", onFocus);
    return () => { stopped = true; clearTimeout(timer); controller.abort(); window.removeEventListener("focus", onFocus); };
  }, [scope, userId, workspaceId, revision]);
  const started = useCallback((job: ConversionJob) => {
    setState(old => ({ scope, error: "", jobs: [job, ...(old.scope === scope ? old.jobs.filter(item => item.id !== job.id) : [])] }));
    refresh(value => value + 1);
  }, [scope]);
  return { jobs: state.scope === scope ? state.jobs : [], error: state.scope === scope ? state.error : "", started };
}
