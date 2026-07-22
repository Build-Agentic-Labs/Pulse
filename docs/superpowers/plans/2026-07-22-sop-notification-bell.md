# SOP Notification Bell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An app-wide top-bar bell showing a self-clearing count of SOPs currently waiting on the viewer, with a grouped dropdown deep-linking to each SOP.

**Architecture:** A pure domain reducer (`summarizeQueue`) over the existing `QueueData` from `fetchReviewQueueData` — the same derivation `/sops/review` uses, so badge and queue can never disagree. One client component mounted once in the shared `UserNav`, polling on mount/focus/60s, silently keeping the last good state on failure. No schema changes, no new endpoints, no read-state.

**Tech Stack:** React 19 client component, existing Supabase browser client, Vitest, Tailwind + one scoped CSS file.

**Spec:** `docs/superpowers/specs/2026-07-22-sop-notification-bell-design.md` — the authority.

## Global Constraints

- Branch: `feat/sop-notification-bell` (already created; spec committed as `bcd30cb`).
- Zero new npm dependencies; zero schema/RLS changes; no new API routes.
- Badge semantics: count = actionable items only (`awaitingMe + finalApprovals + awaitingQuality + sentBack`); **`allInFlight` is never counted**.
- Section order fixed: awaitingMe, finalApprovals, awaitingQuality, sentBack. Labels exactly: "Awaiting my review", "Signature needed", "Ready for release", "Sent back". Empty sections omitted.
- `badgeLabel` caps at `9+`. Badge hidden entirely at total 0.
- Squared geometry — 4px radii, never a pill. Styles in the component's own CSS file, **never `app/globals.css`**.
- The chrome must never break: signed out / no workspace → render `null`; fetch failure → keep last good summary, swallow the error.
- Domain module: type-only import of `QueueData`; no runtime lib/React/Supabase imports.
- Refresh triggers exactly: mount, `window` focus, 60_000 ms interval; all cleaned up on unmount.
- Commit format `<type>(sop): <description>`; gate before finishing any task: `npm run typecheck && npm run lint && npm run test`.

---

### Task 1: Domain — `summarizeQueue` + `badgeLabel`

**Files:**
- Create: `src/domain/sop/queue-summary.ts`
- Test: `src/domain/sop/queue-summary.test.ts`

**Interfaces:**
- Consumes: `QueueData` (type-only) from `@/lib/sop/review-queue-data` — fields used: `awaitingMe: PendingSeat[]` (`sopId`, `sopNumber`, `title`), `finalApprovals: PendingSeat[]`, `awaitingQuality: QualityQueueItem[]` (`id`, `sopNumber`, `title`), `sentBack: SopListItem[]` (`id`, `sopNumber`, `title`).
- Produces (Task 2 imports these exactly):
  - `interface QueueSummaryItem { sopId: string; sopNumber: string | null; title: string | null }`
  - `interface QueueSummarySection { key: "awaitingMe" | "finalApprovals" | "awaitingQuality" | "sentBack"; label: string; items: QueueSummaryItem[] }`
  - `interface QueueSummary { total: number; sections: QueueSummarySection[] }`
  - `function summarizeQueue(queue: QueueData): QueueSummary`
  - `function badgeLabel(total: number): string`

- [ ] **Step 1: Write the failing test**

Create `src/domain/sop/queue-summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { QueueData } from "@/lib/sop/review-queue-data";
import { badgeLabel, summarizeQueue } from "./queue-summary";

// Compact builders: only identity fields vary; the rest are constants that
// satisfy the lib types without mattering to the summary.
function seat(sopId: string, sopNumber: string, title: string): QueueData["awaitingMe"][number] {
  return {
    sopId,
    sopNumber,
    title,
    departmentId: "d1",
    departmentCode: "ENG",
    rasic: "responsible",
    version: "A",
    status: "in_review",
    contentHash: "h",
    finalApprovalRequestedAt: null,
    finalApprovalContentHash: null,
    reviewCycle: 0,
    updatedAt: "2026-07-22T00:00:00Z",
  };
}

function sopItem(id: string, sopNumber: string, title: string): QueueData["sentBack"][number] {
  return {
    id,
    sopNumber,
    title,
    version: "A",
    source: "authored",
    status: "draft",
    updatedAt: "2026-07-22T00:00:00Z",
    departmentId: "d1",
    effectiveDate: null,
    nextReviewDate: null,
    createdBy: "u1",
    rejectedReason: "needs work",
    reviewCycle: 0,
    contentHash: "h",
    finalApprovalRequestedAt: null,
    finalApprovalContentHash: null,
  };
}

function qualityItem(id: string, sopNumber: string, title: string): QueueData["awaitingQuality"][number] {
  return { ...sopItem(id, sopNumber, title), status: "approved", departmentCode: "ENG", departmentName: "Engineering" };
}

function queue(over: Partial<QueueData> = {}): QueueData {
  return {
    awaitingMe: [],
    finalApprovals: [],
    sentBack: [],
    awaitingQuality: [],
    allInFlight: [],
    isQualityApprover: false,
    ...over,
  };
}

describe("summarizeQueue", () => {
  it("totals the four actionable sections and never counts allInFlight", () => {
    const summary = summarizeQueue(
      queue({
        awaitingMe: [seat("s1", "SOP-1", "One")],
        finalApprovals: [seat("s2", "SOP-2", "Two")],
        awaitingQuality: [qualityItem("s3", "SOP-3", "Three")],
        sentBack: [sopItem("s4", "SOP-4", "Four")],
        allInFlight: [sopItem("s9", "SOP-9", "Noise"), sopItem("s10", "SOP-10", "Noise")],
      }),
    );
    expect(summary.total).toBe(4);
  });

  it("keeps the fixed section order and exact labels", () => {
    const summary = summarizeQueue(
      queue({
        sentBack: [sopItem("s4", "SOP-4", "Four")],
        awaitingMe: [seat("s1", "SOP-1", "One")],
        awaitingQuality: [qualityItem("s3", "SOP-3", "Three")],
        finalApprovals: [seat("s2", "SOP-2", "Two")],
      }),
    );
    expect(summary.sections.map((section) => section.label)).toEqual([
      "Awaiting my review",
      "Signature needed",
      "Ready for release",
      "Sent back",
    ]);
  });

  it("omits empty sections", () => {
    const summary = summarizeQueue(queue({ sentBack: [sopItem("s4", "SOP-4", "Four")] }));
    expect(summary.sections.map((section) => section.key)).toEqual(["sentBack"]);
    expect(summary.total).toBe(1);
  });

  it("maps items to sopId/sopNumber/title from both row shapes", () => {
    const summary = summarizeQueue(
      queue({
        awaitingMe: [seat("seat-sop", "SOP-1", "Seat Row")],
        sentBack: [sopItem("list-sop", "SOP-4", "List Row")],
      }),
    );
    expect(summary.sections[0].items).toEqual([{ sopId: "seat-sop", sopNumber: "SOP-1", title: "Seat Row" }]);
    expect(summary.sections[1].items).toEqual([{ sopId: "list-sop", sopNumber: "SOP-4", title: "List Row" }]);
  });

  it("an SOP in two sections counts once per section (no cross-section dedupe)", () => {
    const summary = summarizeQueue(
      queue({
        awaitingMe: [seat("same", "SOP-1", "Same")],
        sentBack: [sopItem("same", "SOP-1", "Same")],
      }),
    );
    expect(summary.total).toBe(2);
  });

  it("empty queue summarizes to zero sections and zero total", () => {
    expect(summarizeQueue(queue())).toEqual({ total: 0, sections: [] });
  });
});

describe("badgeLabel", () => {
  it("shows exact counts through 9 and caps at 9+", () => {
    expect(badgeLabel(0)).toBe("0");
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(9)).toBe("9");
    expect(badgeLabel(10)).toBe("9+");
    expect(badgeLabel(47)).toBe("9+");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/sop/queue-summary.test.ts`
Expected: FAIL — cannot resolve `./queue-summary`.

- [ ] **Step 3: Write minimal implementation**

Create `src/domain/sop/queue-summary.ts`:

```ts
/**
 * Reduces the Review queue's QueueData to what the notification bell renders:
 * a total for the badge and ordered, non-empty sections for the dropdown.
 * Pure — the QueueData import is type-only, so this module carries no runtime
 * dependency on the lib layer. The badge shares the queue page's derivation by
 * construction, so the two can never disagree.
 * Spec: docs/superpowers/specs/2026-07-22-sop-notification-bell-design.md
 */

import type { QueueData } from "@/lib/sop/review-queue-data";

export interface QueueSummaryItem {
  sopId: string;
  sopNumber: string | null;
  title: string | null;
}

export interface QueueSummarySection {
  key: "awaitingMe" | "finalApprovals" | "awaitingQuality" | "sentBack";
  label: string;
  items: QueueSummaryItem[];
}

export interface QueueSummary {
  total: number;
  sections: QueueSummarySection[];
}

export function summarizeQueue(queue: QueueData): QueueSummary {
  const sections: QueueSummarySection[] = [
    {
      key: "awaitingMe",
      label: "Awaiting my review",
      items: queue.awaitingMe.map((row) => ({ sopId: row.sopId, sopNumber: row.sopNumber, title: row.title })),
    },
    {
      key: "finalApprovals",
      label: "Signature needed",
      items: queue.finalApprovals.map((row) => ({ sopId: row.sopId, sopNumber: row.sopNumber, title: row.title })),
    },
    {
      key: "awaitingQuality",
      label: "Ready for release",
      items: queue.awaitingQuality.map((row) => ({ sopId: row.id, sopNumber: row.sopNumber, title: row.title })),
    },
    {
      key: "sentBack",
      label: "Sent back",
      items: queue.sentBack.map((row) => ({ sopId: row.id, sopNumber: row.sopNumber, title: row.title })),
    },
  ].filter((section) => section.items.length > 0);

  return {
    total: sections.reduce((sum, section) => sum + section.items.length, 0),
    sections,
  };
}

/** Badge text: exact through 9, then "9+" — a top-bar tag, not a statistic. */
export function badgeLabel(total: number): string {
  return total > 9 ? "9+" : String(total);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/sop/queue-summary.test.ts`
Expected: PASS (8 tests). Then `npm run typecheck && npm run lint` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/domain/sop/queue-summary.ts src/domain/sop/queue-summary.test.ts
git commit -m "feat(sop): queue summary reducer for the notification bell"
```

---

### Task 2: Bell component, storage-key constant, mount

**Files:**
- Modify: `src/lib/sop/workspace-cookie.ts` (add one exported constant)
- Modify: `src/components/sop/sop-workspace-provider.tsx:14` (use the shared constant)
- Create: `src/components/notification-bell.tsx`
- Create: `src/components/notification-bell.css`
- Modify: `src/components/user-nav.tsx` (~line 302, one mount line + import)

**Interfaces:**
- Consumes: `summarizeQueue`, `badgeLabel`, `QueueSummary` from `@/domain/sop/queue-summary` (Task 1); `fetchReviewQueueData` from `@/lib/sop/review-queue-data` (signature `(workspaceId: string, userId: string, client?) => Promise<QueueData>`); `loadWorkspaceProjectGroups(userId, supabase)` from `@/domain/supabase-planner`; `resolveSupabaseSession(supabase)` from `@/lib/supabase-auth`; `createPlannerSupabaseClient` from `@/domain/supabase-planner`.
- Produces: `NotificationBell` client component, mounted in `UserNav`; `SOP_WORKSPACE_STORAGE_KEY` exported from `src/lib/sop/workspace-cookie.ts`.

No unit tests in this task (interactive chrome — verified live in Task 3); the gate run proves nothing broke.

- [ ] **Step 1: Move the storage key to the plain module**

In `src/lib/sop/workspace-cookie.ts`, append after `SOP_WORKSPACE_COOKIE`:

```ts
/** localStorage twin of the cookie: the SOP provider's saved workspace choice. */
export const SOP_WORKSPACE_STORAGE_KEY = "pulse:sops:workspace-id";
```

In `src/components/sop/sop-workspace-provider.tsx`, extend the existing import on line 9:

```ts
import { SOP_WORKSPACE_COOKIE, SOP_WORKSPACE_STORAGE_KEY } from "@/lib/sop/workspace-cookie";
```

and DELETE line 14's local declaration (`const WORKSPACE_STORAGE_KEY = "pulse:sops:workspace-id";`), replacing every `WORKSPACE_STORAGE_KEY` usage in that file with `SOP_WORKSPACE_STORAGE_KEY` (two usages: the read in the stored-id helper and the write in `writeStoredWorkspaceId`).

- [ ] **Step 2: Create the CSS file**

Create `src/components/notification-bell.css`:

```css
/* Scoped styles for the top-bar notification bell. Squared 4px geometry per
   the design system — never a pill. Colors ride the theme's CSS variables so
   dark mode needs no extra rules. */
.bell-badge {
  position: absolute;
  top: 1px;
  right: 1px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 4px;
  background: var(--color-ink);
  color: var(--color-surface);
  font-size: 9px;
  font-weight: 600;
  line-height: 14px;
  text-align: center;
}

.bell-panel {
  max-height: 420px;
  overflow-y: auto;
}
```

- [ ] **Step 3: Create the component**

Create `src/components/notification-bell.tsx`:

```tsx
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
```

- [ ] **Step 4: Mount in UserNav**

In `src/components/user-nav.tsx`: add the import near the other component imports:

```ts
import { NotificationBell } from "@/components/notification-bell";
```

Then in the `UserNav` return (the `div` with `className="relative flex shrink-0 items-center gap-1"`), insert `<NotificationBell />` immediately AFTER the theme-toggle `</button>` (currently ending around line 302) and BEFORE the `{showSpacesLink ? (` block. No other changes.

- [ ] **Step 5: Gate**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all green (the provider refactor and mount change no behavior; existing tests prove it).

- [ ] **Step 6: Commit**

```bash
git add src/lib/sop/workspace-cookie.ts src/components/sop/sop-workspace-provider.tsx src/components/notification-bell.tsx src/components/notification-bell.css src/components/user-nav.tsx
git commit -m "feat(sop): app-wide notification bell with actionable-count badge"
```

---

### Task 3: Live verification + finish

**Files:** none (verification only).

**Interfaces:** consumes everything above.

- [ ] **Step 1: Full gate including build**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all green.

- [ ] **Step 2: Live browser verification (CLAUDE.md rule 6)**

Start the dev server (preview tool, config "dev") and verify, signed in:

1. **Bell appears outside the SOP space** — on the dashboard (`/`) top bar, and in the planner/Planning chrome.
2. **Badge correctness** — badge count equals the sum of items across the four sections at `/sops/review` (0 → no badge shown).
3. **Dropdown** — click opens the panel; if the queue is empty it reads "Nothing waiting on you."; footer "Open review queue" navigates to `/sops/review`.
4. **Deep link** — with at least one actionable item (the standing QMS solo self-review SOP counts for its author when sent back, or temporarily use another seat state if available): clicking a row lands on `/sops/{id}`.
5. **Self-clearing** — after acting on an item (or on an empty queue), refocusing the window updates the badge without a reload.
6. **Dark mode** — toggle the theme; badge and panel colors follow (CSS vars).
7. Console: no errors from the bell on any of the above pages, including while signed out (`/login` — bell renders nothing).

If any check fails: fix, re-run the gate, re-verify from step 2.

- [ ] **Step 3: Commit any verification fixes, then finish the branch**

```bash
git add -A && git diff --cached --stat
```

Commit only if fixes were made (`fix(sop): ...`). Then use superpowers:finishing-a-development-branch (repo process: push branch → CI green → merge to main → delete branch).
