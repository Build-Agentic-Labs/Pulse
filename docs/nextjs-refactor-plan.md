# Pulse — Next.js architecture refactor plan

Audit date: 2026-07-18 · Baseline commit: `9ec966e`

Goal: restructure the app to use App Router as intended — server-first rendering,
server-side data access, clean module boundaries — **without changing what the
product does**.

---

## 1. Where the app actually is

Verified facts (measured, not estimated):

| Fact | Value |
|---|---|
| Client components (`"use client"`) | 75 of 101 `.tsx` files (74%) |
| Server components that read data | **0** |
| `middleware.ts` | does not exist |
| `@supabase/ssr` | not installed |
| Next.js cache primitives in use | none (`unstable_cache`, `revalidate`, `cache()`) |
| Session storage | browser `localStorage` only; no cookie is ever written |
| Central data layer | `src/domain/supabase-planner.ts` — 4,238 lines, ~79 exports, 0 tests |
| Largest component | `src/components/line-workspace.tsx` — 10,727 lines |
| `app/globals.css` | 5,436 lines, shipped in full to every route |
| Generated Supabase `Database` types | none — all `.from()` queries return `any` |
| CI | none (`.github/` does not exist) |

Bundle baseline (`next build`, commit `9ec966e`):

| Route family | First Load JS |
|---|---:|
| Home / planner / planning / production / mobile capture | 196 kB |
| `/sops` | 205 kB |
| `/planning/work-orders/[id]` | 220 kB |
| `/sops/[sopId]`, `/sops/new` | **253 kB** (worst) |
| Shared by all routes | 103 kB |

### The single root cause

Sessions live in `localStorage`. The server therefore cannot identify the user,
so no page can fetch data server-side, so every data-touching component must be
a client component. The 74% figure is a *consequence*, not a style choice.

Prior optimization work (documented in `nextjs-optimization-status.md`) split and
deferred code, which is why route payloads fell 42% while **shared JS stayed at
103 kB**. Deferring is the cheap half.

**Judge this refactor on the right metric.** The 103 kB shared chunk will *not*
disappear: `supabase-js` still ships to the browser for realtime, client mutations,
and auth. The genuine wins are **TTFB and waterfall collapse** — 6 sequential
browser round trips before first paint become server-side round trips with the
session already parsed. Expect a modest First Load JS improvement, not a dramatic one.

**And there is a real trade to weigh.** Today the app paints from IndexedDB/
localStorage and navigates entirely client-side. RSC navigation costs a server
round trip per navigation, and `cookies()` makes routes fully dynamic (no static
shell without PPR, which is not stable on Next 15). For a shop-floor app on plant
wifi, that can feel *slower* despite better metrics. Preserve the client caches as
the instant-paint path; do not treat retiring them as cleanup.

---

## 2. Two corrections to prior assumptions

**Server-side rendering is not a security fix.** The anon key and the user's JWT
are already in the browser and the PostgREST endpoint is publicly reachable. An
attacker keeps the identical API surface no matter how the UI fetches. RLS is —
correctly — the real boundary, and the audit found it comprehensive: every client
permission check traced has a database backstop, service-role usage is confined to
one correctly-authorized route, and no IDOR was found. Server-side fetching here
buys **performance, correctness, and UX**. Treat any security benefit as secondary
defence in depth.

**The test suite cannot verify "no functionality change."** 336 tests pass, and
they are well-written, but they cover pure domain logic almost exclusively:

- 0 component tests, 0 integration tests, 0 API route tests, 0 e2e (no jsdom, no
  React plugin configured — rendering anything is currently impossible)
- The 4,238-line data layer being relocated has **zero** tests
- 8 test files (~116 tests) cover modules the application never imports. Most
  notably `canTransitionSop` (`src/domain/sop/lifecycle.ts:77`) has 29 excellent
  tests and **zero call sites** — it is a TypeScript mirror of a Postgres trigger,
  free to drift while the suite stays green

The suite covers the layer we are *not* changing and is silent on the layer we
*are*. This drives the sequencing below.

**The dangerous failure mode:** `getUserFromSession` returns `null` rather than
throwing when there is no session. Move a read server-side before cookie auth
works and the page renders **empty or wrong data, with no error and no test
failure**. Every relocation must be verified against real data.

---

## 3. Staged plan

Each stage is independently shippable, independently revertable, and leaves the
app working. Do not start a stage before its predecessor is verified.

### Stage 0 — Safety net (no architectural change)

Nothing here alters behavior. All of it is prerequisite to changing anything safely.

1. **Add CI.** Run typecheck + lint + tests on every push. Today nothing enforces them.
2. **Generate Supabase `Database` types** and apply the generic at the **6**
   `createClient` sites (`src/lib/api-auth.ts` ×2, `app/api/invites/route.ts`,
   `app/api/smart-allocation/route.ts`, `src/domain/supabase-planner.ts` ×2). This
   types ~300 currently-`any` queries and is the single highest-leverage change in
   the audit — a renamed column or typo'd filter currently compiles clean and
   fails at runtime.
3. **Characterization tests for `src/lib/api-auth.ts`** — assert `callerScopedSupabase`
   actually forwards the `Authorization` header. This pins the invariant whose
   silent violation leaks or blanks data.
4. **One end-to-end smoke test** (Playwright) against a seeded database: sign in →
   planner loads → assert row counts match the seed. *Not* mock-based
   characterization tests of the read paths — mocking PostgREST builder chains pins
   implementation detail, costs a lot across ~55 read paths, and structurally
   cannot catch the silent-under-fetch failure that is the main risk. An e2e that
   counts rows can.
5. **Install `jsdom` + `@testing-library/react`** so components *can* be tested.
   Config only, no product risk.
6. **Consolidate `/api/smart-allocation` onto `src/lib/api-auth.ts`** — it
   re-implements `getBearerToken` byte-identically and re-derives the auth flow
   inline. Auth drift on the most exposed endpoint, and it would need every future
   cookie change applied twice.

**Exit criteria:** CI green; typed queries; auth invariant covered by tests.

### Stage 1 — Cheap structural cleanup (behavior-preserving)

Independent of the auth work. Can run in parallel with Stage 0.

7. Delete **confirmed-superseded** code only. "No importers" is not sufficient
   evidence — it cannot distinguish abandoned code from a feature built ahead of
   its UI. Require git history showing the code *once had* importers that were
   later removed:
   - `sop-masthead.tsx` — **confirmed dead.** Imported and rendered by
     `sop-editor.tsx:24` until commit `0b5d1ff`, which replaced it and left the
     file behind. Safe to delete.
   - `_StationBalance` (`line-workspace.tsx`) — underscore-prefixed to evade the
     lint rule. Verify history before removing.
   - The ~36 dead exports and ~31 dead CSS classes need the same per-item check.
     Do not bulk-delete on grep evidence alone. **Timebox this to half a day**:
     dead exports are inert, and a day of history-spelunking on 36 of them is
     negative ROI. Delete what the timebox confirms; leave the rest without guilt.
8. Resolve `src/theme/nothing-design.css` — 404 lines imported by nothing. Either
   delete it or wire it into `/design/nothing`. **Check first:** that route
   currently hangs on "LOADING WORKSPACE" in dev; confirm whether it is also broken.
9. Break the one import cycle: move `WorkOrderMatchInfo` out of
   `work-order-print.tsx` into `src/lib/planning/store.ts`.
10. Consolidate duplicates: `formatDate`/`formatDateTime` (12 sites, 3 divergent
    formats — the same date renders differently on different screens), `parseCsv`
    (copied verbatim with a "keep in sync" comment), `throwIfError` (4 copies).
11. Unify `compareTasksByWbs` — 3 implementations that **sort differently**.
    Promote the gantt version (correct numeric collation). *Behavior-affecting by
    design: it fixes inconsistent ordering.*

### Stage 2 — CSS decomposition

12. **Wrap the unlayered regions of `globals.css` in `@layer components`.** Roughly
    2,000 lines sit outside any `@layer`, and unlayered CSS always beats Tailwind's
    layered utilities regardless of specificity. This is a live bug generator.
    *Behavior-affecting — needs visual QA, since some rules may be relying on
    winning that cascade fight.*
13. Extract route-specific CSS to CSS Modules **opportunistically, not as a
    campaign**. Item 12 (layering) is where the value is; full extraction is not a
    goal in itself. Do the two biggest one-route blocks now — `.mobile-photo-*`
    (~24 kB, one route) and `.ui-auth-*` (~8 kB, login only) — then extract the
    rest per-route as Stage 5/6 touches each route anyway. No target line count
    for `globals.css`; shrinkage is a byproduct, not a deliverable.

Note: CSS is invisible in the JS bundle numbers above. Every route currently pays
for all of it.

### Stage 3 — Cookie sessions (the unlock)

This is the load-bearing change and the riskiest. Three constraints must be
decided *before* writing code:

- **The SolidWorks plugin authenticates with a bearer token and has no cookie
  jar.** `requireApiUser` must accept **cookie session OR bearer token**. Swapping
  rather than adding breaks that integration silently.
- **Realtime authenticates its WebSocket from the client session.** Either the auth
  cookie is non-`httpOnly`, or realtime needs an explicit `setAuth()` path.
  Realtime failure is invisible in development — decide deliberately.
- **`hasLocalSupabaseSession()` reads `localStorage` directly** and will return
  `false` for every signed-in user once the token moves. It gates the cached
  fast-paint and must be replaced.

Steps: install `@supabase/ssr` → add `src/lib/supabase/{client,server}.ts` →
create `middleware.ts` (none exists) → make `requireApiUser` dual-mode → replace
the localStorage session probe.

**Sign-out at cutover is avoidable — decide deliberately.** An earlier version of
this plan called it unavoidable. That was wrong. The valid refresh token is in
`localStorage` (`sb-<ref>-auth-token`), so a one-time bridge in the new client
bootstrap — read the old key, `supabase.auth.setSession()` on the cookie-backed
client, delete the key — migrates every session silently.

A stronger variant de-risks the whole stage: a custom `auth.storage` adapter that
**dual-writes cookie + localStorage**, shipped *before* `@supabase/ssr`. Both auth
modes then run in parallel, so Stage 3 stops being a cutover and becomes
incremental. Strongly preferred for a solo developer — it removes the
stall-halfway-through failure mode.

A clean forced sign-out is still a legitimate choice while all data is test data.
Just make it a choice.

### Stage 4 — Make the data layer client-agnostic

14. Split `supabase-planner.ts` (4,238 lines) by concern. The seam already exists:
    pure mappers, queries, mutations, browser-only (canvas/storage/realtime).
    Extract the pure mappers first — zero risk, and it makes the rest reviewable.
15. Refactor reads to **take a `SupabaseClient` parameter** instead of calling
    `plannerClient()` internally (~55 call sites). Precedent already exists in-file:
    `saveTaskVideoToSupabase(input, supabase)`. This is what makes reads renderable
    from either side.
16. Audit all **29** `getUserFromSession` call sites across 13 files for the
    silent-null failure mode (not ~10 as first estimated — `src/lib/planning/store.ts`
    ×4, `src/lib/departments/store.ts` ×4, six SOP components, and more).
    Server-side the equivalent must be `getUser()`, not `getSession()` — a cookie is
    unverified input on the server. Note this re-introduces the GoTrue rate-limit
    exposure that `getUserFromSession` was written to dodge (see its comment at
    `:299-305`); budget for it.

17. **Eliminate or per-request-scope every module-level mutable in the data layer.**
    This module is written assuming one user per JS realm — true in a browser tab,
    false in a shared server process. Missing this ships a cross-user data leak that
    no test in Stage 0 would catch.
    - `inflightMembershipLoad` (`:1748`) — an **unkeyed** singleton promise. Server-side,
      a second user awaiting it receives **the first user's workspace groups**.
      Confirmed cross-user leak. Must be keyed per request/user or removed.
    - `bootstrappedMembershipUserIds` (`:1744`) — correctly keyed by user id, so
      semantically safe, but grows unbounded in a long-lived server process.
    - `serverPlannerSupabaseClient` (`:263`) — a sessionless anon singleton.
    - `signedUrlCache` (`:55`) — **already correctly guarded**; `cachedSignedUrl` and
      `rememberSignedUrl` no-op when `typeof window === "undefined"` (`:60-75`), with
      a comment explaining exactly this risk. **Do not relax that guard.**

### Stage 5 — Move fetches server-side, highest value first

**Order matters here, and it is deliberately not "biggest win first."** Pilot on the
narrowest blast radius, learn the cookie/RSC/RLS failure modes there, then widen.

18. **SOP screens first — the pilot.** `app/sops/**` is already server shells, the
    cleanest server-component story, and the lowest-stakes place to discover what
    breaks. Also fixes several N+1 queries. Do not skip ahead because the planner
    is the bigger prize.
19. `loadProjectContext` + `ensureDefaultWorkspaceMembership` — a 6-stage waterfall
    on **every route**. Two cautions:
    - `ensureDefaultWorkspaceMembership` **writes during load** (`profiles` upsert +
      `redeem_workspace_access_grants` RPC, `:1768-1777`). Mutating during an RSC
      render is an anti-pattern: prefetches, streaming retries, and speculative
      renders can multi-fire it, and its once-per-session guard is exactly the
      module state flagged in item 17. Restructure it — bootstrap in middleware, a
      route handler, or post-login — rather than relocating it as-is.
    - Its dedupe promise must be fixed first (Stage 4 item 17).
20. Planner load (the dominant waterfall) — pass initial state into
    `line-workspace.tsx` as props. **Extract the state/persistence seam from that
    file first** (Stage 6 item 21); threading server data into a 10,727-line monolith
    that owns its own IndexedDB orchestration and a realtime subscription is how this
    goes wrong. Keep the IndexedDB cache as the offline path.
    Also unhandled today: the **stale-window race** — realtime events occurring
    between the server snapshot and the client's `postgres_changes` subscribe are
    silently lost unless explicitly reconciled.

Only after this does `unstable_cache` / `revalidateTag` make sense. The many
hand-rolled caches (localStorage, IndexedDB, signed-URL map) must be retired **one
at a time with verification** — several solve problems server rendering does not.

### Stage 6 — Component decomposition, then Next.js 16

21. Split `line-workspace.tsx` (10,727 lines, 27 components) — **but only the seams
    Stage 5 actually needs**: state/persistence first (required by item 20), then
    others opportunistically as they block work. A full 27-component decomposition
    of a working file is where solo refactors go to die; do not schedule one.
22. Move the ~480-line deterministic allocation solver out of
    `app/api/smart-allocation/route.ts` into `src/domain/` where it can be tested.
23. Next.js 16 migration, once the baseline is stable.

---

## 4. Separate track — product decisions (not refactor work)

**`self_review_test` mode — DECIDED: stays in place.** It is a deliberate feature
for testing the SOP approval flow single-handed, and it remains while that testing
continues. Its database guards are narrow and it is not a security hole.

**RETIRED 2026-07-25 — the exemption below no longer applies.** Migration
`20260723133000` stubbed both RPCs and cleared the flag; `enableSopSelfReviewTest`
and `soloSelfReviewReady` are gone from the app, so the dead-code and
don't-simplify warnings that stood here are obsolete. What remains is inert: the
`sops.self_review_test` column, two stub RPCs, and `test_self` branches in
`enforce_sop_transition()` / `sign_sop()` that can never be true.

If those branches are ever removed, the functions must be patched in place via
`pg_get_functiondef` + guarded `replace` — never rewritten from a checked-in file,
which silently reverts later migrations. See `deferred-work.md §1` and CLAUDE.md.

**The `canTransitionSop` mirror.** See `deferred-work.md §3`. Not blocking, but do
not carry this refactor forward believing the SOP approval workflow is tested — it
is not.

**Unwired modules — these are unfinished features, not dead code.** Git history
shows each appearing in exactly one commit, never modified, never imported:

| Module | Added | Commit |
|---|---|---|
| `src/domain/schedule-import.ts` (+ its 53-test file) | 2026-07-08 | `2624e0f` "schedule-import resolution module + dry-run gate" |
| `src/domain/sop/numbering.ts` | 2026-07-07 | `f5a237f` "canTransitionSop, numbering, version domain" |
| `src/domain/sop/version.ts` | 2026-07-07 | `f5a237f` (same commit) |

This is the signature of a domain layer built ahead of its UI, not of abandonment.
**Do not delete.** Decide instead whether to finish wiring them up. `numbering.ts`
and `version.ts` shipped alongside `canTransitionSop`, so all three are likely the
same unfinished intent.

---

## 5. Data safety

**This plan performs no database migrations and no data transformations.** No
schema changes, no row moves, no content rewrites. Project data, SOPs, photos and
work orders are untouched. Cookie sessions (Stage 3) change only where the browser
keeps its login token.

RLS also defends the write path: a query running without a valid session is
rejected, producing an error or an empty page — not a corrupted write.

### The one credible data-loss path

Not total failure — **partial success**. A relocated read returns a subset of rows
(wrong scoping, silent null session), the user is legitimately authorized so RLS
permits everything, they edit, and the app saves the truncated state back. Rows
disappear with no error and no log entry.

This is credible because `supabase-planner.ts` contains 29 delete/save operations
and the app performs full-state saves.

Required mitigations:

1. **Never relocate a read and its corresponding write in the same change.** Move
   reads server-side first, verify against real data, and only then follow with writes.
2. **`savePlannerStateToSupabase` replaces wholesale — CONFIRMED.** It computes
   every row present in the database but absent from in-memory state
   (`:2624-2648`) and **hard-deletes them** across six tables (`:2690-2712`):
   tasks, zones, manufacturing components, document type codes, stations, custom
   columns. Task children are wholesale-replaced via the `replace_task_children`
   RPC (`:2676-2684`). The only guard is refusing a *completely empty* task list
   (`:2596`) — a 90%-truncated state saves clean.

   **Add a tripwire before any Stage 5 planner work.** Sequencing rules are not
   sufficient protection against this. Either:
   - refuse a save that would delete more than N% of existing rows, or
   - carry the load's row-count watermark through to the save and refuse on
     unexplained shrinkage.

   This is cheap, and it is the difference between a bug and a data-loss incident.
3. **Back up before each stage** using the existing `scripts/backup-*.mjs` tooling
   — and **verify the restore path works first**. An untested backup is a guess.
4. Consider a separate Supabase project or branch for validating Stage 3 before it
   touches the live database.

## 6. Sequencing rationale

The temptation is to start with Stage 3, because it is where the performance win
lives. That would be a mistake: it is the change most likely to break things
silently, against a test suite that cannot see the breakage, with no CI.

Stages 0–2 deliver real value (typed queries, dead code gone, CSS off the critical
path, consistent dates and sort order) while building the safety net that makes
Stage 3 survivable. Stages 0, 1, and 2 are also independent of each other and can
proceed in parallel.
