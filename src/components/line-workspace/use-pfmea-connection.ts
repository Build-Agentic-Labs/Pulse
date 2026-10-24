'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

type Connection = { scope: string; state: 'online' | 'paused' | 'checking'; error?: string };
/** Online-only editing. Pending drafts survive, but new edits wait for a server recheck. */
export function usePfmeaConnection(scope: string, active: boolean, saveFailed: boolean, recheck: () => Promise<void>) {
  const [connection, setConnection] = useState<Connection>({ scope, state: 'online' });
  const recheckRef = useRef(recheck); recheckRef.current = recheck;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const mounted = useRef(false);
  const attempt = useRef(0);
  const flight = useRef<{ scope: string; promise: Promise<void> } | undefined>(undefined);
  const reconnect = useCallback(() => {
    if (flight.current?.scope === scope) return flight.current.promise;
    if (!navigator.onLine) { setConnection({ scope, state: 'paused', error: 'Connection lost. Editing is paused; pending changes are kept on this device.' }); return Promise.resolve(); }
    setConnection({ scope, state: 'checking' });
    const token = ++attempt.current;
    const check = recheckRef.current;
    const promise = Promise.resolve().then(check).then(() => {
      if (mounted.current && scopeRef.current === scope && attempt.current === token && navigator.onLine) setConnection({ scope, state: 'online' });
    }).catch((error: unknown) => {
      if (mounted.current && scopeRef.current === scope && attempt.current === token) setConnection({ scope, state: 'paused', error: error instanceof Error ? error.message : 'Unable to reconnect. Your pending changes are retained.' });
    }).finally(() => { if (flight.current?.promise === promise) flight.current = undefined; });
    flight.current = { scope, promise };
    return promise;
  }, [scope]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!active) return;
    function offline() { attempt.current++; flight.current = undefined; setConnection({ scope, state: 'paused', error: 'Connection lost. Editing is paused; pending changes are kept on this device.' }); }
    function online() { void reconnect(); }
    if (!navigator.onLine) offline();
    window.addEventListener('offline', offline); window.addEventListener('online', online);
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', online); };
  }, [scope, active, reconnect]);
  const current = connection.scope === scope ? connection : { scope, state: 'online' as const };
  return {
    paused: active && (saveFailed || current.state !== 'online'),
    checking: current.state === 'checking',
    message: current.error ?? (saveFailed ? 'Saving failed. Editing is paused; your pending changes are retained. Retry to reconnect.' : current.state === 'checking' ? 'Reconnecting…' : undefined),
    reconnect,
  };
}
