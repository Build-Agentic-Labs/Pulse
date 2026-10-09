"use client";

import { SOP_NOTIFICATIONS_REFRESH_EVENT, SOP_NOTIFICATIONS_DELIVERED_EVENT } from "@/lib/sop/notify-kick";

import { Bell, CheckCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  badgeLabel,
  excludeAcknowledged,
  summarizeQueue,
  type QueueSummary,
  type QueueSummaryItem,
} from "@/domain/sop/queue-summary";
import { createPlannerSupabaseClient, loadWorkspaceProjectGroups } from "@/domain/supabase-planner";
import { listInbox, markAllInboxRead, markInboxRead, type InboxItem } from "@/lib/notifications/inbox-store";
import { fetchSharedReviewQueue } from "@/lib/sop/shared-review-queue";
import { publishReviewQueueCount } from "@/lib/sop/review-queue-count";
import { SOP_WORKSPACE_STORAGE_KEY } from "@/lib/sop/workspace-cookie";
import { resolveSupabaseSession } from "@/lib/supabase-auth";
import "./notification-bell.css";

const REFRESH_INTERVAL_MS = 60_000;
const ACKNOWLEDGED_STORAGE_PREFIX = "pulse:sop-notification-acknowledged:v1";
const MAX_ACKNOWLEDGED_ITEMS = 200;
const INBOX_LIMIT = 8;

function readAcknowledged(storageKey: string): Set<string> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    return new Set(Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

function writeAcknowledged(storageKey: string, ids: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(Array.from(ids).slice(-MAX_ACKNOWLEDGED_ITEMS)));
  } catch {
    // Acknowledgment still applies to the current render if browser storage is unavailable.
  }
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * Two feeds behind one bell: the self-clearing count of SOPs currently waiting
 * on the viewer (derived from the same data as /sops/review), and the recent
 * inbox — the durable, cross-device record of what the viewer was notified
 * about. Null summary = signed out, no workspace, or nothing fetched yet. The
 * button itself is permanent chrome; only its badge and menu contents depend on
 * this asynchronous state. Failures keep the last good state.
 */
function useNotificationState(): {
  summary: QueueSummary | null;
  inbox: InboxItem[];
  loading: boolean;
  acknowledge: (item: QueueSummaryItem) => void;
  markRead: (id: number) => void;
  markAllRead: () => void;
  dismissInbox: (ids: number[]) => void;
} {
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [summary, setSummary] = useState<QueueSummary | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const storageKeyRef = useRef<string | null>(null);
  const dismissedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let refreshVersion = 0;
    let inFlight = false;
    let pending: "all" | "inbox" | null = null;
    let lastRefreshAt = 0;
    let currentScope: string | null = null;
    let currentUserId: string | null = null;

    async function refresh(requested: "all" | "inbox") {
      const version = refreshVersion;
      try {
        const { session } = await resolveSupabaseSession(supabase);
        if (!mounted || version !== refreshVersion) return;
        const user = session?.user;
        currentUserId = user?.id ?? null;
        if (!user) {
          if (mounted && version === refreshVersion) {
            setSummary(null);
            setInbox([]);
            setLoaded(true);
            storageKeyRef.current = null;
            dismissedKeyRef.current = null;
            currentScope = null;
          }
          return;
        }

        let workspaceId: string | null = null;
        try {
          workspaceId = window.localStorage.getItem(SOP_WORKSPACE_STORAGE_KEY);
        } catch {
          workspaceId = null;
        }
        if (!workspaceId) {
          const groups = await loadWorkspaceProjectGroups(user.id, supabase);
          workspaceId = groups[0]?.workspace.id ?? null;
        }

        const scope = JSON.stringify([user.id, workspaceId]);
        const refreshQueue = requested === "all" || currentScope !== scope;
        // Delivery completion refreshes only the inbox. Workflow mutations and
        // ordinary ticks still refresh the actionable queue at its existing cadence.
        const [items, queue] = await Promise.all([
          listInbox(INBOX_LIMIT, supabase),
          refreshQueue && workspaceId ? fetchSharedReviewQueue(workspaceId, user.id, supabase) : Promise.resolve(null),
        ]);
        if (!mounted || version !== refreshVersion) return;
        const dismissedKey = `pulse:notification-dismissed:v1:${user.id}`;
        dismissedKeyRef.current = dismissedKey;
        const dismissed = readAcknowledged(dismissedKey);
        setInbox(items.filter(item => !dismissed.has(String(item.id))));
        if (workspaceId && queue) {
          const storageKey = `${ACKNOWLEDGED_STORAGE_PREFIX}:${workspaceId}:${user.id}`;
          storageKeyRef.current = storageKey;
          const summaryForQueue = summarizeQueue(queue);
          publishReviewQueueCount(workspaceId, summaryForQueue.total);
          setSummary(excludeAcknowledged(summaryForQueue, readAcknowledged(storageKey)));
        } else if (refreshQueue) {
          storageKeyRef.current = null;
          setSummary(null);
        }
        currentScope = scope;
        setLoaded(true);
      } catch {
        // Keep the last good state; retry on the next trigger.
        if (mounted && version === refreshVersion) setLoaded(true);
      }
    }

    function requestRefresh(kind: "all" | "inbox" = "all", force = false) {
      if (!mounted) return;
      if (force) {
        if (kind === "all") refreshVersion += 1;
        pending = pending === "all" ? "all" : kind;
      }
      if (document.visibilityState !== "visible" || inFlight) return;
      if (!force && !pending && Date.now() - lastRefreshAt < 1_000) return;
      const next = pending === "all" || kind === "all" ? "all" : "inbox";
      pending = null;
      inFlight = true;
      void refresh(next).finally(() => {
        inFlight = false;
        lastRefreshAt = Date.now();
        // A mutation/delivery while reading cannot be swallowed by the overlap guard.
        if (pending) requestRefresh(pending, true);
      });
    }

    requestRefresh();
    const interval = window.setInterval(() => requestRefresh(), REFRESH_INTERVAL_MS);
    const onFocus = () => requestRefresh();
    const onMutation = () => requestRefresh("all", true);
    const onDelivery = () => requestRefresh("inbox", true);
    const onStorage = (event: StorageEvent) => {
      if (event.key === SOP_WORKSPACE_STORAGE_KEY) onMutation();
    };
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_OUT" && event !== "SIGNED_IN") return;
      if (event === "SIGNED_IN" && session?.user.id === currentUserId) return;
      refreshVersion += 1;
      if (event === "SIGNED_OUT") {
        currentUserId = null;
        currentScope = null;
        storageKeyRef.current = null;
        dismissedKeyRef.current = null;
        setSummary(null);
        setInbox([]);
      }
      // Run outside the auth callback so resolving the session cannot deadlock it.
      queueMicrotask(onMutation);
    });
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("storage", onStorage);
    window.addEventListener(SOP_NOTIFICATIONS_REFRESH_EVENT, onMutation);
    window.addEventListener(SOP_NOTIFICATIONS_DELIVERED_EVENT, onDelivery);
    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SOP_NOTIFICATIONS_REFRESH_EVENT, onMutation);
      window.removeEventListener(SOP_NOTIFICATIONS_DELIVERED_EVENT, onDelivery);
    };
  }, [supabase]);

  const acknowledge = useCallback((item: QueueSummaryItem) => {
    const storageKey = storageKeyRef.current;
    if (storageKey) {
      const acknowledged = readAcknowledged(storageKey);
      acknowledged.add(item.notificationId);
      writeAcknowledged(storageKey, acknowledged);
    }
    setSummary((current) =>
      current ? excludeAcknowledged(current, new Set([item.notificationId])) : current,
    );
  }, []);

  const markRead = useCallback(
    (id: number) => {
      const stamp = new Date().toISOString();
      setInbox((current) => current.map((item) => (item.id === id && !item.readAt ? { ...item, readAt: stamp } : item)));
      void markInboxRead([id], supabase).catch(() => {
        // The optimistic state stands; the next refresh reconciles.
      });
    },
    [supabase],
  );

  const markAllRead = useCallback(() => {
    const stamp = new Date().toISOString();
    setInbox((current) => current.map((item) => (item.readAt ? item : { ...item, readAt: stamp })));
    void markAllInboxRead(supabase).catch(() => {
      // As above.
    });
  }, [supabase]);

  const dismissInbox = useCallback((ids: number[]) => {
    const key = dismissedKeyRef.current;
    if (key) {
      const dismissed = readAcknowledged(key);
      ids.forEach(id => dismissed.add(String(id)));
      writeAcknowledged(key, dismissed);
    }
    setInbox(current => current.filter(item => !ids.includes(item.id)));
  }, []);

  return { summary, inbox, loading: !loaded, acknowledge, markRead, markAllRead, dismissInbox };
}

export function NotificationBell() {
  const router = useRouter();
  const { summary, inbox, loading, acknowledge, markRead, markAllRead, dismissInbox } = useNotificationState();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const [leaving, setLeaving] = useState<number[]>([]);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (dismissTimer.current) clearTimeout(dismissTimer.current); }, []);
  function animateDismiss(ids: number[]) {
    if (!ids.length || leaving.length) return;
    setLeaving(ids);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    dismissTimer.current = setTimeout(() => {
      dismissInbox(ids);
      setLeaving([]);
      dismissTimer.current = null;
    }, reduced ? 0 : 420);
  }

  // Same outside-click/Escape dismissal UserNav's menus use.
  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const total = summary?.total ?? 0;
  const sections = summary?.sections ?? [];
  const unread = inbox.filter((item) => !item.readAt).length;
  const notificationCount = total > 0 ? total : unread;

  return (
    <div ref={containerRef} className="relative flex shrink-0 items-center">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="ui-btn-ghost relative inline-flex h-8 w-8 items-center justify-center px-0"
        title="Notifications"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={loading ? "true" : undefined}
        aria-description={unread > 0 ? `${unread} unread notifications` : undefined}
        aria-label={total > 0 ? `Notifications: ${total} waiting on you` : "Notifications"}
      >
        <Bell size={15} strokeWidth={1.75} />
        {notificationCount > 0 ? <span className="bell-badge" aria-hidden="true">{badgeLabel(notificationCount)}</span> : null}
      </button>

      {(
        <div role="menu" data-open={open} aria-hidden={!open} inert={!open} aria-label="Notifications" className="bell-panel absolute right-0 top-full z-50 mt-2">
          <div className="bell-panel-header">
            <div><h2>Notifications</h2><p>{unread > 0 ? `${unread} unread` : "You’re up to date"}</p></div>
            <div className="flex items-center gap-1">
            {inbox.some(item => item.readAt) ? <button type="button" role="menuitem" className="ui-btn-ghost h-8 px-2 text-[11px]" disabled={leaving.length > 0} onClick={() => animateDismiss(inbox.filter(item => item.readAt).map(item => item.id))}>Clear read</button> : null}
            {inbox.length > 0 ? <button type="button" role="menuitem" className="ui-btn-ghost h-8 gap-1.5 px-2 text-[11px]" onClick={() => markAllRead()} disabled={unread === 0}><CheckCheck size={14} />Mark all read</button> : null}
            </div>
          </div>
          <div className="bell-panel-list">
          {loading ? (
            <div className="px-2.5 py-3 text-[12px] text-ink-tertiary">Checking notifications…</div>
          ) : sections.length === 0 && inbox.length === 0 ? (
            <div className="px-2.5 py-3 text-[12px] text-ink-tertiary">Nothing waiting on you.</div>
          ) : (
            <>
              {sections.map((section) => (
                <div key={section.key}>
                  <div className="px-2.5 pb-1 pt-2 ui-mono-label text-ink-tertiary">{section.label}</div>
                  {section.items.map((item) => (
                    <button
                      key={item.notificationId}
                      type="button"
                      role="menuitem"
                      className="bell-queue-item ui-btn-ghost flex w-full items-center justify-start gap-2 px-2.5 text-left text-[12px]"
                      onClick={() => {
                        acknowledge(item);
                        setOpen(false);
                        router.push(item.href);
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="bell-message-title">{item.title || "Untitled SOP"}</span>
                        <span className="bell-message-meta">{item.sopNumber}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
              {inbox.length > 0 ? (
                <div>
                  <div className="px-2.5 pb-1 pt-2 ui-mono-label text-ink-tertiary">Recent</div>
                  {inbox.map((item) => {
                    const sopTitle = item.link?.startsWith("/sops") ? item.title.match(/^([^:]+):\s*(?:SOP\s+)?["“]?(.+?)["”]?$/) : null;
                    return <div key={item.id} className="bell-dismiss-row" data-leaving={leaving.includes(item.id)} inert={leaving.includes(item.id)}>
                    <div className="bell-dismiss-clip"><div className="bell-dismiss-content">
                    <button
                      type="button"
                      role="menuitem"
                      data-unread={item.readAt ? "false" : "true"}
                      aria-label={item.title}
                      className="bell-inbox-item ui-btn-ghost flex w-full items-start justify-start gap-2 px-2.5 py-1.5 text-left text-[12px]"
                      onClick={() => {
                        markRead(item.id);
                        setOpen(false);
                        if (item.link) router.push(item.link);
                      }}
                    >
                      <span className="bell-inbox-marker" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        {sopTitle ? <span className="bell-message-meta bell-message-action">{sopTitle[1]}</span> : null}
                        <span className="bell-message-title">{sopTitle ? sopTitle[2] : item.title}</span>
                        {!sopTitle && item.body ? <span className="bell-message-body">{item.body}</span> : null}
                      </span>
                      <span className="bell-message-time">{timeAgo(item.createdAt)}</span>
                    </button>
                    <button type="button" className="bell-dismiss-button ui-btn-ghost" aria-label={`Dismiss ${item.title}`} disabled={leaving.length > 0} onClick={() => animateDismiss([item.id])}><X size={13} /></button>
                    </div></div></div>;
                  })}
                </div>
              ) : null}
            </>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
