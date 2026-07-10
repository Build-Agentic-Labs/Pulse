# Mobile Blocker Fixes — Design

**Date:** 2026-07-09
**Status:** Draft — awaiting review
**Scope decision:** "Fix the blockers only." Make Pulse *usable* on a phone. Not redesigned for one.

---

## Context

Pulse is a desktop-first application. It is built as a fixed, non-scrolling shell (`html, body { overflow: hidden }`) in which each screen supplies its own scroll container. Only 16 of 61 components in `src/` use any responsive breakpoint, and those overwhelmingly *add* affordances on wide screens (`hidden sm:flex`, `lg:hidden`) rather than collapsing gracefully on narrow ones.

A full responsive rebuild would mean reworking the 10,741-line `line-workspace.tsx`, replacing the Gantt's HTML5 drag-and-drop with a touch-capable system, and reflowing seven tables. That is out of scope.

This spec covers a much narrower goal: **remove the defects that make Pulse actively broken on a phone**, leaving it cramped but functional. The largest of these is a scroll trap that can make content unreachable — including on the sign-in screen.

---

## Findings (verified against source)

### 1. Scroll traps — the real bug

`app/layout.tsx` sets `overflow: hidden` on both `<html>` and `<body>` (reinforced at `globals.css:206–211`). Five elements declare `min-height: 100dvh` / `min-h-screen` **inside** that non-scrolling body. `min-height` permits growth; the clipped body forbids reaching it. Any content taller than the viewport is silently unreachable.

| Site | Screen | Severity |
|---|---|---|
| `app/globals.css:4744` — `.ui-auth-split` | **Sign in / create account** | **High** — blocks entry to the app |
| `src/components/company-dashboard.tsx:118` | App home | High — space cards below fold |
| `src/components/space-placeholder.tsx:24` | Production space | Medium |
| `src/components/auth-project-gate.tsx:474` | "No project access yet" | Medium |
| `src/components/auth-project-gate.tsx:427` | "Project unavailable" | Low — short panel |

The create-account variant of `AuthFormPanel` (`src/components/app-flow-panels.tsx:217`) is the tallest auth form (full name + email + password). On a short viewport, or with the soft keyboard raised, it overflows.

### 2. No viewport export — safe-area code is inert

`app/layout.tsx` has no `export const viewport`, so Next.js applies its default. Consequently `viewport-fit=cover` is never set, and **every `env(safe-area-inset-*)` in the codebase resolves to `0`** — at `globals.css:814`, `:978`, `:3900`, and throughout `mobile-photo-portal.tsx`. That notch-handling code exists and currently does nothing.

### 3. `.excel-addin-shell` is dead code

`globals.css:213–216` declares `min-width: 980px; min-height: 720px`. The class is referenced in **zero** `.tsx` files. A vestige of an Excel add-in era.

### 4. Wide tables scroll, but invisibly

Five tables carry a hard minimum width. All five already sit inside `overflow-x-auto` wrappers, so they *do* scroll horizontally. The problem is `globals.css:226` — `* { scrollbar-width: none }` hides every scrollbar app-wide, so nothing signals that content continues past the screen edge.

| File | Min width |
|---|---|
| `src/components/planning/work-order-board.tsx:337` | `1000px` |
| `src/components/planning/work-order-detail.tsx:515` | `960px` |
| `src/components/gantt-timeline.tsx:2718` | `900px` |
| `src/components/sop/sop-list.tsx:394` | `680px` |
| `src/components/planning/planning-settings.tsx:193` | `520px` |

### 5. Affordances with no touch equivalent

Corrected after reading source — two items originally listed here were **not** defects:

- ~~`gantt-timeline.tsx:343` tooltip on a non-focusable span~~ — **false.** `TaktConditionFlag` (`:331`) already sets `tabIndex={0}`, carries the `group` class, and pairs `group-hover:block` with `group-focus:block`, plus `title` and `aria-label`. Tapping focuses it and reveals the tooltip. No change needed.
- ~~`gantt-timeline.tsx:1480` double-click rename~~ — **false.** That handler is `onDoubleClick → onResetHeadcount()` on the Headcount column header, and an equivalent `<button>` already sits immediately after it. Not a touch blocker.
- `src/components/scenario-tabs.tsx:147` — **real.** `startRename()` has exactly one call site: the tab's `onDoubleClick`. Its `title` reads "Double-click to rename". No tap-reachable path exists.
- `src/components/gantt-timeline.tsx` — row reordering uses native HTML5 drag (`onDragStart` / `onDrop`). **These events never fire on touch.** Not fixable within this scope.

---

## Design

### C1 — Add a viewport export
`app/layout.tsx`. Add `export const viewport: Viewport` with `width: "device-width"`, `initialScale: 1`, `viewportFit: "cover"`. This activates the existing, currently-inert `env(safe-area-inset-*)` rules.

### C2 — Close the five scroll traps
Uniform transformation at each site:

```
min-height: 100dvh   →   height: 100dvh; overflow-y: auto;
min-h-screen         →   h-[100dvh] overflow-y-auto
```

Rationale: content shorter than the viewport renders identically (no scrollbar). Content taller now scrolls rather than clipping. Desktop behaviour is unchanged because these screens seldom overflow at desktop heights.

The idiom already exists and is correct in `src/components/planning/planning-shell.tsx:30` (`h-[100dvh] flex flex-col`) and `src/components/sop/sop-shell.tsx:51` — those two shells need no change. Match their pattern.

Order of work: `.ui-auth-split` first (it gates entry), then `company-dashboard.tsx`, then the rest.

### C3 — Delete `.excel-addin-shell`
Remove `globals.css:213–216`. No references exist.

### C4 — Make horizontal table scroll discoverable
Add a `.ui-table-scroll` class to `globals.css` providing a thin, visible scrollbar. Apply it to the **four** table wrappers in Finding 4. The Gantt's `min-w-[900px]` panel is excluded — the Gantt is desktop-only per C6, so a mobile scroll affordance there would be misleading.

Follow the existing precedent at `globals.css:231` — `.step-photo-strip` already re-enables `scrollbar-width: thin` for exactly this reason. **Do not** copy its `touch-action: pan-x`: that strip deliberately locks to one axis, whereas a table must pan horizontally *and* let the page scroll vertically.

**Constraint (per project convention):** do not modify the shared `ui-*` classes, which are used app-wide. Use a page-scoped override block, matching the established `.sop-editor` / `.ui-depts` / `.ui-wo-toolbar` precedent. Follow Pulse geometry: 4px radius on controls, 6px on panels — no pills.

### C5 — Restore the one missing touch path
`scenario-tabs.tsx` — add a tap-reachable rename control alongside the retained double-click, and update the `title` text so it no longer instructs a touch user to double-click. The tab is a `<button role="tab">`, so the control must be a **sibling**, not a child (nested buttons are invalid HTML).

The two other items previously listed here were verified to be non-defects; see Finding 5.

### C6 — Disclose the Gantt reorder limitation
Gantt row reordering is HTML5-drag-based and cannot work on touch. Rather than leave it silently inert, surface a brief note when the Gantt is viewed below the `lg` breakpoint, indicating reordering requires a larger screen.

---

## Out of scope

Explicitly **not** part of this work:

- Reflowing any table into a card/stacked layout
- Any change to `line-workspace.tsx` (10,741 lines)
- Mobile navigation (drawer, hamburger, bottom nav)
- Replacing the Gantt's HTML5 drag-and-drop with touch DnD — reordering stays desktop-only (disclosed via C6)
- Long-press for `step-photo-viewer.tsx` right-click annotation menus (`:1135`, `:1175`) — **photo annotation remains desktop-only** by decision
- Releasing the global `html, body { overflow: hidden }` — the shell model is sound and the shells that matter already handle their own scroll correctly

---

## Verification

1. **Reproduce first, then fix.** Before changing `.ui-auth-split`, load `/login` at a 375×500 viewport (short, e.g. landscape phone) and confirm the create-account form's submit button is unreachable. If it is *not* reproducible, revisit the premise before proceeding.
2. After each change, re-check the same viewport and confirm the content scrolls.
3. **Desktop regression check** — the primary risk. Load `/`, `/login`, `/planning`, `/sops`, and a project planner at 1440×900 and confirm no new scrollbars, no layout shift, and that the planner's fixed-shell behaviour is unchanged.
4. Confirm horizontal scroll on the five tables at 375px width shows a visible affordance.
5. Confirm the Gantt warning badge reveals its tooltip on tap.
6. Run the project verification gate: typecheck, tests, lint, build.

---

## Risks

- **C2 is the risky change.** Converting `min-height` → `height` on a root element changes the flex/grid sizing contract for its children. If a child relied on the parent growing, it will now scroll inside a fixed frame instead. `.ui-auth-split` is a grid with `place-items-center`-style centering, so it is the most likely to shift. Verify visually at desktop widths, not just mobile.
- **C4** touches the same `overflow-x-auto` wrappers currently modified in the working tree (`work-order-board.tsx` is dirty). Coordinate to avoid conflict.
- The working tree already has uncommitted changes to `app/globals.css`, `work-order-board.tsx`, and `departments-admin.tsx`. This work overlaps the first two.
