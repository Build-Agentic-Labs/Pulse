# Mobile Blocker Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pulse usable on a phone by removing five scroll traps, activating the dormant safe-area code, and restoring the one missing touch affordance — without redesigning any screen.

**Architecture:** Pulse is a fixed, non-scrolling desktop shell (`html, body { overflow: hidden }`) in which each screen owns its scroll container. That model is sound and is **kept**. The bug is that five root elements declare `min-height: 100dvh` inside that clipped body — `min-height` lets content grow, the body forbids reaching it. Each becomes its own scroll container instead. Everything else is additive: a viewport export, a new CSS class, one button, one note.

**Tech Stack:** Next.js 15 (App Router), React 19, Tailwind (default breakpoints, no custom `screens`), a 5,000-line custom `ui-*` CSS design system in `app/globals.css`. Vitest for domain unit tests. No component test library.

**Spec:** `docs/superpowers/specs/2026-07-09-mobile-blocker-fixes-design.md`

---

## Global Constraints

- **Never modify shared `ui-*` classes.** They are used app-wide. Add new classes; extend selector lists additively. (Existing precedent: `.sop-editor`, `.ui-depts`, `.ui-wo-toolbar` page-scoped blocks.)
- **Pulse geometry — no pills.** 4px radius on controls/tags/buttons/fields, 6px on panels/cards. Never `rounded-full` on a control.
- **Never disable pinch-zoom.** Do not set `maximumScale` or `userScalable` in the viewport export — that is an accessibility failure.
- **No `console.log`** in committed code.
- **Verification gate**, run before every commit: `npm run typecheck && npm run test && npm run lint && npm run build`
- Conventional commits: `fix:`, `feat:`, `chore:`.

## On testing

There is no component test infrastructure in this repo — `vitest` exists but every test is a pure domain/lib unit test under `src/domain/` and `src/lib/`. **You cannot unit-test "`min-height` inside an `overflow:hidden` body clips content."** Writing vitest tests for these changes would be ceremony that asserts nothing.

**Task 2 only** gets a real red/green loop through a live browser, because `/login` is the one affected screen reachable without a session. The controller runs that loop and records the evidence.

**Tasks 3-6 cannot be browser-verified by a subagent.** `/`, `/planning`, and the Gantt are all auth-gated; a fresh browser lands on the login screen. Rather than pretend otherwise, those tasks verify by:

1. a **static check** that the defect existed and the fix landed (grep / computed-CSS reasoning), and
2. the full gate: `npm run typecheck && npm run test && npm run lint && npm run build`.

Visual confirmation is deferred to the **Manual QA checklist** at the end of this plan, which the human runs against a logged-in session. This is a real weakening of the guarantee and is stated here so nobody mistakes a green gate for a proven fix. Only Task 2's fix is *demonstrated*; Tasks 3-6 are *argued*.

**Do not** attempt `browser_navigate` to auth-gated routes in Tasks 3-6. It will land on `/login` and any assertion you make about the result will be about the wrong page.

The dev server is already running at `http://localhost:3000` (started by the controller).

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `app/layout.tsx` | Root document; add `viewport` export | 1 |
| `app/globals.css` | Delete dead rule; fix `.ui-auth-split`; add `.ui-table-scroll`, `.ui-scenario-tab-edit` | 1, 2, 4, 5 |
| `src/components/company-dashboard.tsx` | Home scroll container | 3 |
| `src/components/space-placeholder.tsx` | Placeholder scroll container | 3 |
| `src/components/auth-project-gate.tsx` | Two error-panel scroll containers | 3 |
| `src/components/planning/work-order-board.tsx` | Table scroll affordance | 4 |
| `src/components/planning/work-order-detail.tsx` | Table scroll affordance | 4 |
| `src/components/sop/sop-list.tsx` | Table scroll affordance | 4 |
| `src/components/planning/planning-settings.tsx` | Table scroll affordance | 4 |
| `src/components/scenario-tabs.tsx` | Tap-reachable rename | 5 |
| `src/components/gantt-timeline.tsx` | Reorder-limitation note | 6 |

**Not touched:** `line-workspace.tsx` beyond nothing at all; `step-photo-viewer.tsx` (photo annotation stays desktop-only, by decision); the Gantt's HTML5 drag-and-drop (reordering stays desktop-only, disclosed in Task 6).

---

## Task 1: Foundation — viewport export + dead CSS removal

Zero behaviour change expected on desktop. Activates `env(safe-area-inset-*)`, which currently resolves to `0` everywhere because `viewport-fit=cover` is never set.

**Files:**
- Modify: `app/layout.tsx:1` (import) and after `app/layout.tsx:56-64` (metadata block)
- Modify: `app/globals.css:213-216` (delete)

- [ ] **Step 1: Confirm `.excel-addin-shell` is genuinely dead**

```bash
grep -rn "excel-addin-shell" src/ app/ --include=*.tsx --include=*.ts
```

Expected: **no output** (the only hit is its own definition in `globals.css`). If this prints a `.tsx` match, STOP — the rule is live; do not delete it.

- [ ] **Step 2: Widen the type import in `app/layout.tsx`**

Line 1 currently reads:

```ts
import type { Metadata } from "next";
```

Change to:

```ts
import type { Metadata, Viewport } from "next";
```

- [ ] **Step 3: Add the viewport export**

In `app/layout.tsx`, immediately after the closing `};` of the `export const metadata: Metadata = { ... }` block (ends ~line 64) and before `export const dynamic = "force-dynamic";`, insert:

```ts
// `viewportFit: "cover"` is load-bearing: every `env(safe-area-inset-*)` in the
// codebase resolves to 0 without it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
```

Do **not** add `maximumScale` or `userScalable`.

- [ ] **Step 4: Delete the dead rule**

In `app/globals.css`, delete lines 213-216 in full:

```css
.excel-addin-shell {
  min-width: 980px;
  min-height: 720px;
}
```

- [ ] **Step 5: Run the gate**

```bash
npm run typecheck && npm run test && npm run lint && npm run build
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app/layout.tsx app/globals.css
git commit -m "fix(mobile): add viewport export with viewport-fit cover; drop dead excel-addin-shell rule"
```

---

## Task 2: Close the auth scroll trap

The highest-value fix — it gates entry to the app — and the **riskiest**, because changing `min-height` to `height` on a grid root changes the sizing contract its children inherit. Reproduce before fixing.

**Files:**
- Modify: `app/globals.css:4740-4746`

**Interfaces:**
- Produces: the `height: 100dvh; overflow-y: auto` idiom that Task 3 repeats.

- [ ] **Step 1: Reproduce the trap (RED)**

With the dev server running, drive the Playwright MCP browser:

1. `browser_resize` → width `375`, height `500` (a short viewport; equivalent to a landscape phone or a phone with the soft keyboard raised).
2. `browser_navigate` → `http://localhost:3000/login`
3. Switch the form to its **tallest** variant — click the control that reveals create-account (full name + email + password). Use `browser_snapshot` to locate it.
4. `browser_evaluate` with:

```js
() => {
  const split = document.querySelector('.ui-auth-split');
  const cs = getComputedStyle(split);
  const overflows = split.scrollHeight > window.innerHeight;
  const canScroll = split.scrollHeight > split.clientHeight
    && ['auto', 'scroll'].includes(cs.overflowY);
  return {
    contentTallerThanViewport: overflows,
    splitCanScroll: canScroll,
    bodyOverflowY: getComputedStyle(document.body).overflowY,
    trapped: overflows && !canScroll,
  };
}
```

Expected (RED): `trapped: true`, `bodyOverflowY: "hidden"`, `splitCanScroll: false`.

**If `trapped` is `false`, STOP.** The premise is wrong at this viewport. Try height `420`, then a taller form. If still false, report back before changing anything — do not fix a bug you cannot demonstrate.

- [ ] **Step 2: Apply the fix**

In `app/globals.css`, replace lines 4740-4746:

```css
.ui-auth-split {
  position: relative;
  display: grid;
  grid-template-columns: 1fr;
  min-height: 100dvh;
  background: var(--color-canvas);
}
```

with:

```css
/* `height` + `overflow-y: auto`, not `min-height`: the body is `overflow: hidden`,
   so a growing root clips its own content out of reach. Content shorter than the
   viewport renders identically (no scrollbar appears). */
.ui-auth-split {
  position: relative;
  display: grid;
  grid-template-columns: 1fr;
  height: 100dvh;
  overflow-y: auto;
  background: var(--color-canvas);
}
```

- [ ] **Step 3: Verify the trap is gone (GREEN)**

Re-run the exact `browser_evaluate` from Step 1.

Expected: `trapped: false`, `splitCanScroll: true`.

Then `browser_snapshot` and confirm the create-account submit button is reachable by scrolling.

- [ ] **Step 4: Desktop regression check — the real risk**

`browser_resize` → `1440` × `900`, reload `/login`, `browser_screenshot`.

Confirm all three:
- the left brand column (`.ui-auth-brand`, shown at ≥900px) still fills the full viewport height,
- the form is still vertically centred,
- no scrollbar appeared.

**If the brand column collapsed to content height**, the single grid row stopped stretching. Fall back to:

```css
.ui-auth-split { height: 100dvh; overflow-y: auto; align-content: stretch; }
.ui-auth-form-side { min-height: 100dvh; }
```

and re-run Steps 3 and 4.

- [ ] **Step 5: Run the gate**

```bash
npm run typecheck && npm run test && npm run lint && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add app/globals.css
git commit -m "fix(mobile): make auth split scroll instead of clipping content out of reach"
```

---

## Task 3: Close the four remaining scroll traps

Same transformation as Task 2, applied to four TSX roots. Lower risk: none of these centre a full-height grid.

**Files:**
- Modify: `src/components/company-dashboard.tsx:118`
- Modify: `src/components/space-placeholder.tsx:24`
- Modify: `src/components/auth-project-gate.tsx:427`
- Modify: `src/components/auth-project-gate.tsx:474`

**Interfaces:**
- Consumes: the `h-[100dvh] overflow-y-auto` idiom established in Task 2.

- [ ] **Step 1: Confirm the defect statically (RED)**

These routes are auth-gated — do not open a browser. Confirm the four sites still carry the defect:

```bash
grep -n "min-h-screen" src/components/company-dashboard.tsx src/components/space-placeholder.tsx src/components/auth-project-gate.tsx
```

Expected: exactly four hits — `company-dashboard.tsx:118`, `space-placeholder.tsx:24`, `auth-project-gate.tsx:427`, `auth-project-gate.tsx:474`.

Each is a root element whose ancestor `<body>` carries `overflow: hidden` (`app/layout.tsx`, `app/globals.css:206-211`). `min-height` permits growth; the clipped body forbids reaching it.

If the count is not four, the file has moved on — stop and report.

- [ ] **Step 2: Fix `company-dashboard.tsx`**

Line 118 currently:

```tsx
    <div className="min-h-screen bg-canvas text-ink">
```

Change to:

```tsx
    <div className="h-[100dvh] overflow-y-auto bg-canvas text-ink">
```

The `sticky top-0` header at line 125 needs no change — it was inert before (nothing scrolled) and now sticks correctly to this new scroll container.

- [ ] **Step 3: Fix `space-placeholder.tsx`**

Line 24 currently:

```tsx
    <div className="min-h-screen bg-canvas text-ink">
```

Change to:

```tsx
    <div className="h-[100dvh] overflow-y-auto bg-canvas text-ink">
```

- [ ] **Step 4: Fix both `auth-project-gate.tsx` panels**

Lines 427 and 474 are identical:

```tsx
        <main className="grid min-h-screen place-items-center bg-canvas px-4 text-ink">
```

Change **both** to:

```tsx
        <main className="grid h-[100dvh] place-items-center overflow-y-auto bg-canvas px-4 py-8 text-ink">
```

`py-8` gives the panel breathing room once it can scroll. Note the classic centred-overflow hazard: with `place-items-center`, content taller than the container is clipped at the **top**, unreachable by scrolling. These two panels are short (heading + paragraph + button, `max-w-lg`) so it should not trigger. If Step 5 shows top-clipping, swap `place-items-center` for `place-items-[safe_center]`.

- [ ] **Step 5: Verify the fix landed (GREEN)**

```bash
grep -rn "min-h-screen" src/components/company-dashboard.tsx src/components/space-placeholder.tsx src/components/auth-project-gate.tsx
```

Expected: **no output.** All four converted.

```bash
grep -rn "h-\[100dvh\]" src/components/company-dashboard.tsx src/components/space-placeholder.tsx src/components/auth-project-gate.tsx
```

Expected: four hits, each paired with `overflow-y-auto` on the same element.

Do **not** open a browser against these routes — they are auth-gated. Visual confirmation happens in the Manual QA checklist.

- [ ] **Step 6: Confirm no sibling regressions**

`company-dashboard.tsx` has a `sticky top-0` header (line ~125) and a `fixed inset-0` decorative glow (~line 120). Confirm by reading that neither moved into the new scroll container's coordinate space in a way that breaks them: `fixed` is viewport-relative and unaffected; `sticky` now sticks to the new scroll container, which is the intended improvement (it was inert before, because nothing scrolled).

State this reasoning in your report. Do not change either element.

- [ ] **Step 7: Run the gate**

```bash
npm run typecheck && npm run test && npm run lint && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add src/components/company-dashboard.tsx src/components/space-placeholder.tsx src/components/auth-project-gate.tsx
git commit -m "fix(mobile): give dashboard, placeholder, and access panels their own scroll containers"
```

---

## Task 4: Make horizontal table scroll discoverable

The four tables already scroll — they sit in `overflow-x-auto` wrappers. But `globals.css:226` sets `* { scrollbar-width: none }`, hiding every scrollbar app-wide, so nothing signals the table continues past the screen edge.

The Gantt's `min-w-[900px]` panel (`gantt-timeline.tsx:2718`) is **excluded**: the Gantt is desktop-only, per Task 6.

**Files:**
- Modify: `app/globals.css` (add `.ui-table-scroll` near the existing `.step-photo-strip` block, ~line 231)
- Modify: `src/components/planning/work-order-board.tsx:337`
- Modify: `src/components/planning/work-order-detail.tsx:515`
- Modify: `src/components/sop/sop-list.tsx:394`
- Modify: `src/components/planning/planning-settings.tsx:193`

**Interfaces:**
- Produces: `.ui-table-scroll` — a drop-in replacement for `overflow-x-auto` on wide-table wrappers.

- [ ] **Step 1: Add the class**

In `app/globals.css`, directly after the existing `.step-photo-strip` rules (which already re-enable a thin scrollbar for exactly this reason), add:

```css
/* Wide data tables already scroll, but `* { scrollbar-width: none }` above hides
   every scrollbar — so nothing tells a phone user the table continues off-screen.
   Restore a thin scrollbar on these wrappers only. No `touch-action` override:
   a table must pan horizontally AND let the page scroll vertically. */
.ui-table-scroll {
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--color-ink-secondary) 45%, transparent) transparent;
}

.ui-table-scroll::-webkit-scrollbar {
  height: 8px;
}

.ui-table-scroll::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-ink-secondary) 45%, transparent);
}
```

4px thumb radius, per the no-pills constraint.

- [ ] **Step 2: Swap the four wrappers**

`src/components/planning/work-order-board.tsx:337` — the `<div>` wrapping the `min-w-[1000px]` table:

```tsx
            <div className="overflow-x-auto">
```
→
```tsx
            <div className="ui-table-scroll">
```

`src/components/planning/work-order-detail.tsx:515`:

```tsx
            <div className="overflow-x-auto">
```
→
```tsx
            <div className="ui-table-scroll">
```

`src/components/sop/sop-list.tsx:394`:

```tsx
                    <div className="overflow-x-auto">
```
→
```tsx
                    <div className="ui-table-scroll">
```

`src/components/planning/planning-settings.tsx:193` — keep the other utilities:

```tsx
                  <div className="mt-3 overflow-x-auto rounded-md border border-line">
```
→
```tsx
                  <div className="mt-3 ui-table-scroll rounded-md border border-line">
```

- [ ] **Step 3: Verify (GREEN)**

`/planning` and `/sops` are auth-gated — do not open a browser. Verify statically:

```bash
grep -rn "overflow-x-auto" src/components/planning/work-order-board.tsx src/components/planning/work-order-detail.tsx src/components/sop/sop-list.tsx src/components/planning/planning-settings.tsx
```

Expected: **no output** (all four swapped).

```bash
grep -c "ui-table-scroll" app/globals.css
grep -rn "ui-table-scroll" src/components/planning/ src/components/sop/sop-list.tsx
```

Expected: the class is defined in `globals.css` and applied at exactly four call sites.

Confirm by reading `globals.css` that `.ui-table-scroll` sets **no `touch-action`**. A table must pan horizontally *and* let the page scroll vertically; `.step-photo-strip`'s `touch-action: pan-x` would break the latter. State this in your report.

- [ ] **Step 4: Confirm the Gantt was left alone**

```bash
grep -n "ui-table-scroll" src/components/gantt-timeline.tsx
```

Expected: **no output.** The Gantt is desktop-only per Task 6; it must not gain a mobile scroll affordance.

- [ ] **Step 5: Run the gate**

```bash
npm run typecheck && npm run test && npm run lint && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add app/globals.css src/components/planning/work-order-board.tsx src/components/planning/work-order-detail.tsx src/components/sop/sop-list.tsx src/components/planning/planning-settings.tsx
git commit -m "feat(mobile): add ui-table-scroll so wide tables show a scroll affordance"
```

---

## Task 5: Give scenario rename a tap-reachable path

`startRename()` in `scenario-tabs.tsx` has exactly one call site: the tab's `onDoubleClick` (line 147). Its tooltip reads "Double-click to rename." There is no touch path.

The tab is a `<button role="tab">`, so the new control must be a **sibling**, not a child — nested buttons are invalid HTML. A sibling already exists: the delete button (`.ui-scenario-tab-close`, line 156-165). Copy that shape exactly.

`.ui-scenario-tab-close` is revealed by `.ui-scenario-tab:hover` or `.ui-scenario-tab-active` (`globals.css:4186-4187`), which works on touch: tap the tab to activate it, the controls appear.

**Files:**
- Modify: `src/components/scenario-tabs.tsx:4` (import), `:143` (title), after `:154` (new button)
- Modify: `app/globals.css` (add `.ui-scenario-tab-edit`, extend the reveal selectors)

- [ ] **Step 1: Add the CSS**

In `app/globals.css`, directly after the `.ui-scenario-tab-close` rule (starts line 4169), add a mirrored rule. Copy every property from `.ui-scenario-tab-close` verbatim except `margin-right`, which becomes `0.125rem` so the two buttons sit together.

**`opacity: 0` and the `transition` are load-bearing, not decoration.** `.ui-scenario-tab-close` is hidden by default and revealed by the `:hover` / `.ui-scenario-tab-active` rule below. Omit `opacity: 0` and the pencil inherits the CSS initial value `1`, sitting permanently visible on every non-main tab while its ✕ sibling stays hidden. *(This is exactly what happened on the first attempt — the properties were transcribed from a truncated view of the source rule and dropped.)*

```css
  .ui-scenario-tab-edit {
    display: inline-flex;
    height: 1rem;
    width: 1rem;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    align-self: center;
    margin-right: 0.125rem;
    border: 0;
    border-radius: 0.2rem;
    background: transparent;
    color: color-mix(in srgb, var(--color-steel) 82%, transparent);
    opacity: 0;
    transition: opacity 160ms var(--ease-ui), background 160ms var(--ease-ui), color 160ms var(--ease-ui);
  }
```

Then extend the existing reveal selector list at lines 4186-4187 **additively** — add two new selectors, change neither existing one:

```css
  .ui-scenario-tab:hover .ui-scenario-tab-close,
  .ui-scenario-tab-active .ui-scenario-tab-close,
  .ui-scenario-tab:hover .ui-scenario-tab-edit,
  .ui-scenario-tab-active .ui-scenario-tab-edit,
```

(Keep whatever selectors already follow on the next lines.)

- [ ] **Step 2: Import the icon**

`src/components/scenario-tabs.tsx:4` currently:

```ts
import { Loader2, Plus, X } from "lucide-react";
```

Change to:

```ts
import { Loader2, Pencil, Plus, X } from "lucide-react";
```

- [ ] **Step 3: Fix the misleading tooltip**

Line 143 currently:

```tsx
                title={isMain ? "Master plan" : scenario.notes || "Double-click to rename"}
```

Change to:

```tsx
                title={isMain ? "Master plan" : scenario.notes || "Switch to this projection"}
```

- [ ] **Step 4: Add the rename button**

Insert immediately after the tab `</button>` (line 154) and **before** the `{!isMain ? (` delete-button block at line 155:

```tsx
              {!isMain ? (
                <button
                  type="button"
                  disabled={isSwitching}
                  title="Rename this projection"
                  aria-label={`Rename ${scenario.name || "scenario"}`}
                  onClick={() => startRename(scenario)}
                  className="ui-scenario-tab-edit"
                >
                  <Pencil size={10} />
                </button>
              ) : null}
```

Leave the existing `onDoubleClick` on the tab in place — it stays as a desktop shortcut.

- [ ] **Step 5: Verify (GREEN)**

The Gantt is auth-gated — do not open a browser. Verify by reading:

- `startRename` now has **two** call sites: the tab's `onDoubleClick` and the new button's `onClick`. Confirm with `grep -n "startRename" src/components/scenario-tabs.tsx` (expect 3 hits: the definition plus two call sites).
- The new `<button>` is a **sibling** of the tab `<button>`, not a child. Read the JSX and confirm. Nested buttons are invalid HTML and React will not warn you.
- The rename button renders only when `!isMain`, matching the delete button.
- `.ui-scenario-tab-edit` is defined in `globals.css` and appears in the reveal selector list alongside `.ui-scenario-tab-close`, so it is visible on `:hover` or `.ui-scenario-tab-active`.
- The old `"Double-click to rename"` string is gone: `grep -rn "Double-click to rename" src/` returns nothing.

- [ ] **Step 6: Run the gate**

```bash
npm run typecheck && npm run test && npm run lint && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add app/globals.css src/components/scenario-tabs.tsx
git commit -m "feat(mobile): add tap-reachable rename control to scenario tabs"
```

---

## Task 6: Disclose the Gantt touch limitations

Two Gantt interactions do not work on touch, and we are fixing neither:

1. **Row reordering** uses native HTML5 drag (`draggable` + `onDragStart`/`onDrop`, around `gantt-timeline.tsx:1623`). **These events never fire on touch.**
2. **Task renaming** is `onDoubleClick`-only. `beginEditingTaskName` (`gantt-timeline.tsx:897`) has exactly two call sites, `:1700` and `:2012`, both `onDoubleClick`. The `onClick` on those buttons calls `activateRow(row)` instead. There is no tap path. *(Discovered during Task 5; not in the original spec.)*

Rather than leave both features silently inert, say so. The note must name both — disclosing only reordering would be misleading.

The note must sit outside every horizontal scroller, or it will be off-screen at `375px`. `GanttTimeline`'s root is a fragment at `:1434` wrapping `<section className="ui-gantt-timeline">` at `:1435` — insert between them.

**Files:**
- Modify: `src/components/gantt-timeline.tsx:1434`

- [ ] **Step 1: Add the note**

Lines 1433-1435 currently:

```tsx
  return (
    <>
    <section className="ui-gantt-timeline">
```

Change to:

```tsx
  return (
    <>
    {/* Reordering is native HTML5 drag-and-drop and renaming is onDoubleClick-only;
        neither fires on touch. Say so rather than let both fail silently on a phone. */}
    <p className="border-b border-line bg-surface-sunken px-3 py-2 text-[11px] leading-snug text-ink-secondary lg:hidden">
      Reordering and renaming tasks require a larger screen.
    </p>
    <section className="ui-gantt-timeline">
```

- [ ] **Step 2: Verify (GREEN)**

The Gantt is auth-gated — do not open a browser. Verify by reading:

- The `<p>` sits between the fragment `<>` and `<section className="ui-gantt-timeline">`, so it is outside `.ui-gantt-timeline-grid` and outside every `overflow-x` container. If it were inside, it would sit off-screen at 375px — the exact failure this note exists to prevent.
- It carries `lg:hidden`. Confirm `tailwind.config.ts` defines no custom `screens` key, so `lg:` is Tailwind's default 1024px.
- No `rounded-full` (no-pills constraint).

- [ ] **Step 3: Run the gate**

```bash
npm run typecheck && npm run test && npm run lint && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/gantt-timeline.tsx
git commit -m "feat(mobile): disclose that gantt row reordering needs a larger screen"
```

---

## Final verification (automated)

- [ ] `npm run typecheck && npm run test && npm run lint && npm run build` passes.
- [ ] `git log --oneline -6` shows six focused commits.
- [ ] `grep -rn "min-h-screen" src/` returns nothing.
- [ ] `grep -rn "excel-addin-shell" .` matches nothing outside this plan and the spec.
- [ ] No `maximumScale` or `userScalable` anywhere in `app/`.

## Manual QA checklist (human, logged in)

Tasks 3-6 were verified statically, not demonstrated. These steps are where they are actually proven. Run them in a real browser at a phone viewport (DevTools device toolbar, 375×667) **and** at 1440×900.

**The fix worked if, at 375×667:**
- [ ] `/login` — switch to create-account; the submit button is reachable by scrolling. *(This one was demonstrated in Task 2; re-confirm.)*
- [ ] `/` — the dashboard scrolls to the last space card. The top bar stays stuck while scrolling.
- [ ] `/production` — the placeholder scrolls to its bottom.
- [ ] `/planning` — the work-order table scrolls sideways **and shows a visible scrollbar**. A vertical swipe starting over the table still scrolls the page.
- [ ] `/sops` — same for the SOP table.
- [ ] Gantt — the note "Reordering tasks requires a larger screen" appears above the timeline.
- [ ] Gantt — tap a non-Main scenario tab; a pencil appears beside the ✕; tapping it opens the rename input. The Main tab shows neither.
- [ ] Pinch-zoom works everywhere (we never disabled it).

**Nothing regressed if, at 1440×900:**
- [ ] `/login` — the left brand column still fills the full viewport height, the form is still centred, no scrollbar appeared. *(The single highest-risk item in this plan.)*
- [ ] `/` and `/production` — no new scrollbars, no layout shift.
- [ ] Gantt — the mobile note is **gone**, and row drag-and-drop reordering still works.
- [ ] The project planner's fixed-shell behaviour is unchanged.

If the brand column at `/login` collapsed to content height, apply the Task 2 Step 4 fallback.

## Known limitations after this work

Stated plainly so nobody mistakes them for bugs:

- Gantt row reordering is desktop-only (disclosed in the UI).
- Photo annotation (`step-photo-viewer.tsx`) is desktop-only; its annotation menu is right-click-driven.
- Wide tables scroll horizontally rather than reflowing into cards.
- There is still no mobile navigation — no drawer, hamburger, or bottom nav.
- `line-workspace.tsx` (10,741 lines) is untouched and remains desktop-first.
