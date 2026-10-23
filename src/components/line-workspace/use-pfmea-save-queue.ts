'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPfmeaSaveQueue, type PfmeaSaveResult } from '@/domain/pfmea-save-queue';
import type { WorkspaceWriteTracker } from '@/domain/workspace-save-status';
import type { PfmeaDocument } from '@/domain/pfmea';
import { savePfmeaToSupabase } from '@/lib/planner/pfmea-store';

export function usePfmeaSaveQueue(productId: string, projectId: string | undefined, tracker: WorkspaceWriteTracker, onSaved: (document: PfmeaDocument, productId: string) => void) {
  const savedCallback = useRef(onSaved);
  savedCallback.current = onSaved;
  const [result, setResult] = useState<(PfmeaSaveResult & { productId: string })>();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const queue = useMemo(() => createPfmeaSaveQueue({
    key: `pfmea:${productId}`, tracker,
    save: (document, base) => {
      if (!projectId) return Promise.reject(new Error('Choose a project before editing PFMEA.'));
      return savePfmeaToSupabase(productId, projectId, document, base).then(() => { if (mounted.current) savedCallback.current(document, productId); });
    },
    report: next => { if (mounted.current) setResult({ ...next, productId }); },
  }), [productId, projectId, tracker]);
  useEffect(() => {
    const flush = () => { void queue.flush(); };
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    const link = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (target && !target.hasAttribute('download') && target.getAttribute('target') !== '_blank') flush();
    };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('click', link, true);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('beforeunload', flush); document.removeEventListener('click', link, true); window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', visibility); flush(); };
  }, [queue]);
  return { queue, result: result?.productId === productId ? result : undefined };
}
