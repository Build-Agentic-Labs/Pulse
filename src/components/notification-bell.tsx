"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { badgeLabel, summarizeQueue, type QueueSummary } from "@/domain/sop/queue-summary";
import { createPlannerSupabaseClient, loadWorkspaceProjectGroups } from "@/domain/supabase-planner";
import { fetchReviewQueueData } from "@/lib/sop/review-queue-data";
import { SOP_WORKSPACE_STORAGE_KEY } from "@/lib/sop/workspace-cookie";
import { resolveSupabaseSession } from "@/lib/supabase-auth";
import "./notification-bell.css";

const REFRESH_INTERVAL_MS = 60_000;

/**
 * Self-clearing count of SOPs currently waiting on the viewer, recomputed from
 * the same derivation as /sops/review. Null summary = signed out, no
 * workspace, or nothing fetched yet — in every such state the bell renders
 * nothing, because the chrome must never break or flash over a background
 * concern. Failures keep the last good summary for the same reason.
 */
function useActionableQueue(): QueueSummary | null {
  const supabase = useMemo(() => createPlannerSupabaseClient(), []);
  const [summary, setSummary] = useState<QueueSummary | null>(null);

  useEffect(() => {
    let mounted = true;

    async function refresh() {
      try {
        const { session } = await resolveSupabaseSession(supabase);
        const user = session?.user;
        if (!user) {
          if (mounted) setSummary(null);
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
        if (!workspaceId) {
          if (mounted) setSummary(null);
          return;
        }

        const queue = await fetchReviewQueueData(workspaceId, user.id);
        if (mounted) setSummary(summarizeQueue(queue));
      } catch {
        // Keep the last good summary; retry on the next trigger.
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

  return summary;
}

export function NotificationBell() {
  const router = useRouter();
  const summary = useActionableQueue();
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

  if (!summary) {
    return null;
  }

  const { total, sections } = summary;

  return (
    <div ref={containerRef} className="relative flex shrink-0 items-center">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="ui-btn-ghost relative inline-flex h-8 w-8 items-center justify-center px-0"
        title="SOP notifications"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={total > 0 ? `SOP notifications: ${total} waiting on you` : "SOP notifications"}
      >
        <Bell size={15} strokeWidth={1.75} />
        {total > 0 ? <span className="bell-badge">{badgeLabel(total)}</span> : null}
      </button>

      {open ? (
        <div role="menu" className="bell-panel absolute right-0 top-full z-50 mt-2 w-72 ui-panel p-1.5 shadow-modal">
          {sections.length === 0 ? (
            <div className="px-2.5 py-3 text-[12px] text-ink-tertiary">Nothing waiting on you.</div>
          ) : (
            sections.map((section) => (
              <div key={section.key}>
                <div className="px-2.5 pb-1 pt-2 ui-mono-label text-ink-tertiary">{section.label}</div>
                {section.items.map((item) => (
                  <button
                    key={`${section.key}:${item.sopId}`}
                    type="button"
                    role="menuitem"
                    className="ui-btn-ghost flex h-8 w-full items-center justify-start gap-2 px-2.5 text-[12px]"
                    onClick={() => {
                      setOpen(false);
                      router.push(`/sops/${item.sopId}`);
                    }}
                  >
                    <span className="truncate">
                      {item.sopNumber || "SOP"} · {item.title || "Untitled SOP"}
                    </span>
                  </button>
                ))}
              </div>
            ))
          )}
          <div className="my-1 h-px bg-line" />
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
