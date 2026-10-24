'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPfmeaSaveQueue, samePfmeaValue, type PfmeaSaveResult } from '@/domain/pfmea-save-queue';
import type { WorkspaceWriteTracker } from '@/domain/workspace-save-status';
import type { PfmeaDocument } from '@/domain/pfmea';
import { createPfmeaDraftJournal } from '@/lib/planner/pfmea-drafts';
import { getUserFromSession, plannerClient } from '@/lib/planner/client';
import { savePfmeaToSupabase } from '@/lib/planner/pfmea-store';
import { PRODUCT_PFMEA_DOCUMENT_FIELD } from '@/domain/pfmea';
import { usePfmeaConnection } from './use-pfmea-connection';
import { createPfmeaCellWriter } from '@/lib/planner/pfmea-cell-store';

export function usePfmeaSaveQueue(productId: string, projectId: string | undefined, tracker: WorkspaceWriteTracker, onSaved: (document: PfmeaDocument, productId: string) => void, recovery?: { remote: unknown; enabled: boolean; active?: boolean; cellSaving?: boolean }) {
  const recoveryActive = Boolean(recovery);
  const [actor, setActor] = useState<string>();
  const actorRef = useRef<string | undefined>(undefined);
  const [localError, setLocalError] = useState<string>();
  const [recoveredQueue, setRecoveredQueue] = useState<unknown>();
  useEffect(() => {
    if (!recoveryActive) return;
    const client = plannerClient();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      actorRef.current = session?.user.id;
      setActor(session?.user.id);
    });
    return () => subscription.unsubscribe();
  }, [recoveryActive]);
  const journal = useMemo(() => {
    if (!actor || !projectId || !recoveryActive || typeof window === 'undefined') return;
    try { return createPfmeaDraftJournal(window.localStorage, actor, projectId, productId, crypto.randomUUID()); }
    catch { return undefined; }
  }, [actor, projectId, productId, recoveryActive]);
  const savedCallback = useRef(onSaved);
  savedCallback.current = onSaved;
  const [result, setResult] = useState<(PfmeaSaveResult & { productId: string; actor?: string })>();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const cellSaving = recovery?.cellSaving === true;
  const queue = useMemo(() => {
    let cellWriter: ReturnType<typeof createPfmeaCellWriter> | undefined;
    return createPfmeaSaveQueue({
    key: `pfmea:${productId}`, tracker,
    retain: (document, base) => {
      if (!recoveryActive) return;
      try {
        if (!journal) throw new Error('Local storage unavailable');
        journal.write(document, base);
        setLocalError(undefined);
      } catch { setLocalError('Device backup unavailable. Keep this page open until the server save finishes.'); }
    },
    acknowledge: document => {
      if (cellSaving) return; // The cell session atomically acknowledges its exact mutation and versions.
      try { journal?.acknowledge(document); }
      catch { setLocalError('Device backup could not be updated. Keep this page open until the server save finishes.'); }
    },
    save: async (document, base) => {
      if (!navigator.onLine) throw new Error('Connection lost. Your pending PFMEA changes are retained.');
      if (!projectId) return Promise.reject(new Error('Choose a project before editing PFMEA.'));
      if (recoveryActive) {
        const current = await getUserFromSession(plannerClient());
        if (!actor || current.data.user?.id !== actor || actorRef.current !== actor) throw new Error('Account changed. Your PFMEA draft remains on this device.');
      }
      const confirmed = cellSaving
        ? (await (cellWriter ??= createPfmeaCellWriter(productId, projectId, base, plannerClient(), journal ? {
          pending: journal.pendingCellMutation(), retain: pending => journal.retainCellMutation(pending), acknowledge: (saved, baseline) => journal.acknowledge(saved, baseline),
        } : undefined, document)).save(document)).document
        : await savePfmeaToSupabase(productId, projectId, document, base).then(() => document);
      if (mounted.current && (!recoveryActive || actorRef.current === actor)) savedCallback.current(confirmed, productId);
    },
    report: next => { if (mounted.current) setResult({ ...next, productId, actor }); },
    });
  }, [productId, projectId, tracker, journal, actor, recoveryActive, cellSaving]);
  const currentResult = result?.productId === productId && result.actor === actor ? result : undefined;
  const connection = usePfmeaConnection(`${actor ?? ''}:${projectId ?? ''}:${productId}`, Boolean(recovery?.enabled && recovery.active), currentResult?.state === 'error', async () => {
    if (!projectId) throw new Error('Choose a project before reconnecting.');
    const { data, error } = await plannerClient().from('products').select('custom_fields').eq('id', productId).eq('project_id', projectId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('PFMEA unavailable. Check project access before retrying.');
    if (queue.hasWork()) {
      // The save contract rechecks the original base before writing retained edits.
      await queue.flush();
      if (queue.hasWork()) throw new Error('Pending PFMEA changes could not be saved. Editing remains paused.');
    } else {
      const fields = data.custom_fields as Record<string, unknown> | null;
      if (!samePfmeaValue(fields?.[PRODUCT_PFMEA_DOCUMENT_FIELD], recovery?.remote)) throw new Error('This PFMEA changed while disconnected. Reload to load the latest saved version.');
    }
  });
  useEffect(() => {
    if (!recovery?.enabled || !actor || recoveredQueue === queue) return;
    if (!journal) {
      setLocalError('Device backup unavailable. Keep this page open until the server save finishes.');
      setRecoveredQueue(queue);
      return;
    }
    try {
      const draft = journal.recover(recovery.remote);
      if (draft) queue.schedule(draft.document, draft.base);
      setRecoveredQueue(queue);
    } catch {
      setLocalError('Device backup unavailable. Keep this page open until the server save finishes.');
      setRecoveredQueue(queue);
    }
  }, [queue, journal, actor, recovery?.enabled, recovery?.remote, recoveredQueue]);
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
  return { queue, connection, ready: !recovery || Boolean(actor && (!recovery.enabled || recoveredQueue === queue)), localError, result: currentResult };
}
