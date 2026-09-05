"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
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
import { fetchReviewQueueData } from "@/lib/sop/review-queue-data";
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
} {
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [summary, setSummary] = useState<QueueSummary | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const storageKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function refresh() {
      try {
        const { session } = await resolveSupabaseSession(supabase);
        const user = session?.user;
        if (!user) {
          if (mounted) {
            setSummary(null);
            setInbox([]);
            setLoaded(true);
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

        // The inbox is user-level and needs no workspace; the actionable count does.
        const [items, queue] = await Promise.all([
          listInbox(INBOX_LIMIT, supabase),
          workspaceId ? fetchReviewQueueData(workspaceId, user.id) : Promise.resolve(null),
        ]);
        if (!mounted) return;
        setInbox(items);
        if (workspaceId && queue) {
          const storageKey = `${ACKNOWLEDGED_STORAGE_PREFIX}:${workspaceId}:${user.id}`;
          storageKeyRef.current = storageKey;
          setSummary(excludeAcknowledged(summarizeQueue(queue), readAcknowledged(storageKey)));
        } else {
          setSummary(null);
        }
        setLoaded(true);
      } catch {
        // Keep the last good state; retry on the next trigger.
        if (mounted) setLoaded(true);
      }
    }

    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      mounted = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
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

  return { summary, inbox, loading: !loaded, acknowledge, markRead, markAllRead };
}

export function NotificationBell() {
  const router = useRouter();
  const { summary, inbox, loading, acknowledge, markRead, markAllRead } = useNotificationState();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={containerRef} className="relative flex shrink-0 items-center">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="ui-btn-ghost relative inline-flex h-8 w-8 items-center justify-center px-0"
        title="SOP notifications"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={loading ? "true" : undefined}
        aria-label={total > 0 ? `SOP notifications: ${total} waiting on you` : "SOP notifications"}
      >
        <Bell size={15} strokeWidth={1.75} />
        {total > 0 ? <span className="bell-badge">{badgeLabel(total)}</span> : null}
        {total === 0 && unread > 0 ? <span className="bell-dot" aria-hidden="true" /> : null}
      </button>

      {open ? (
        <div role="menu" className="bell-panel absolute right-0 top-full z-50 mt-2 w-80 ui-panel p-1.5 shadow-modal">
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
                      className="ui-btn-ghost flex h-8 w-full items-center justify-start gap-2 px-2.5 text-[12px]"
                      onClick={() => {
                        acknowledge(item);
                        setOpen(false);
                        router.push(`/sops/${item.sopId}`);
                      }}
                    >
                      <span className="truncate">
                        {item.sopNumber} · {item.title || "Untitled SOP"}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
              {inbox.length > 0 ? (
                <div>
                  <div className="px-2.5 pb-1 pt-2 ui-mono-label text-ink-tertiary">Recent</div>
                  {inbox.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      data-unread={item.readAt ? "false" : "true"}
                      className="bell-inbox-item ui-btn-ghost flex w-full items-start justify-start gap-2 px-2.5 py-1.5 text-left text-[12px]"
                      onClick={() => {
                        markRead(item.id);
                        setOpen(false);
                        router.push(item.link ?? "/sops/review");
                      }}
                    >
                      <span className="bell-inbox-marker" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{item.title}</span>
                        {item.body ? <span className="block truncate text-ink-tertiary">{item.body}</span> : null}
                      </span>
                      <span className="shrink-0 ui-mono-label text-ink-tertiary">{timeAgo(item.createdAt)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
          <div className="my-1 h-px bg-line" />
          {inbox.length > 0 ? (
            <button
              type="button"
              role="menuitem"
              className="ui-btn-ghost flex h-8 w-full items-center justify-start px-2.5 text-[12px]"
              onClick={() => markAllRead()}
            >
              Mark all read
            </button>
          ) : null}
          <Link
            href="/sops/review"
            role="menuitem"
            className="ui-btn-ghost flex h-8 w-full items-center justify-start px-2.5 text-[12px]"
            onClick={() => setOpen(false)}
          >
            Open review queue
          </Link>
        </div>
      ) : null}
    </div>
  );
}
