# Pulse — conventions

Next.js 16 (App Router, Turbopack) + Supabase (RLS-enforced) + React 19.
These rules exist because the 2026-07 architecture refactor
(docs/nextjs-refactor-plan.md) established them the hard way. Follow them and
the app stays fast and safe; drift and it quietly rots back.

## The feature recipe

Every new feature, in this order:

1. **Schema + RLS first.** The database is the enforcement layer — UI checks are
   mirrors for UX, never the gate. Write the migration with its policies, apply
   it, then `npm run gen:types` (needs SUPABASE_ACCESS_TOKEN) so queries are
   typed against the new schema. A feature whose RLS you can't state in one
   sentence isn't designed yet.
2. **Domain logic in `src/domain/`, pure and tested.** No React, no Supabase, no
   DOM. If it computes, sorts, validates, or decides — it's domain, and it gets
   a test file next to it.
3. **Data access in a store (`src/lib/*/store.ts` pattern)** with the optional
   injected client:
   `function listThings(scopeId: string, client?: SupabaseClient<Database>)`
   `const supabase = client ?? createPlannerSupabaseClient();`
   That one parameter is what lets the same read serve the browser AND a server
   component.
4. **Server-first UI.** The page (server component) fetches the first paint with
   `createSupabaseServerClient()` + `auth.getUser()`, passes it down as an
   `initial*` prop; the client component seeds its state from it and
   revalidates in the background (see SopList / AuthProjectGate / LineWorkspace
   for the exact pattern, including the `freshnessRef` seeding trick). Every
   failure path omits the initial data and the client loads as a fallback —
   server fetch is an accelerant, never a dependency.
5. **`"use client"` only for a reason you can name**: interactivity, browser
   APIs, realtime. "It fetches data" is no longer a reason.
6. **Verify live before merging.** Typecheck + lint + tests, then actually drive
   the feature in the browser. A green suite does not prove a rendered screen.

## Hard rules (each one is a scar)

- **Server reads are READ-ONLY.** Never mutate during an RSC render — prefetches
  and streaming retries multi-fire. Writes live in client effects, route
  handlers, or server actions.
- **Never full-state save.** `savePlannerStateToSupabase` hard-deletes rows
  absent from memory and is guarded by a tripwire (`assertSaneStateDeletion`) —
  do not weaken it, and do not build new save paths in its image. New features
  write granularly (upsert what changed).
- **`enforce_sop_transition` and `sign_sop` are patched IN PLACE — never rewrite
  their bodies from a file here.** No file in `supabase/migrations/` holds their
  current text: several migrations read the *live* definition
  (`pg_get_functiondef(...)`), string-`replace` fragments, and `execute` the
  result. `grep -rl pg_get_functiondef supabase/migrations/` finds them. A
  full-body rewrite authored from the newest checked-in file silently reverts
  every later patch — this cost us a near-miss on 2026-07-25, where reinstating a
  removed "exactly one Accountable seat" gate against a schema that now forbids
  `rasic = 'accountable'` would have made *every* `draft → in_review` raise. Copy
  the guarded-replace pattern instead: assert each anchor with
  `if position($from$…$from$ in v_definition) = 0 then raise exception …`, then a
  single `execute v_definition`, so a drifted base fails loudly. Verify anchors
  are present AND unique by replaying the applied patches in timestamp order, and
  confirm after with `npx supabase db query --linked`. Green tests prove nothing
  here — the bug lives in the database, not the repo.
- **Embedding `departments` from `sops` needs an explicit FK hint:**
  `department:departments!sops_department_id_fkey(code)`. Three paths connect the
  two tables — the direct column, plus `sop_review_seats` and `sop_signatures`,
  which each carry a `sop_id` *and* a department FK and so read as junction
  tables. Without the hint PostgREST returns `PGRST201`. The `Relationships`
  array in `database.types.ts` lists only outgoing FKs and will not warn you.
- **Auth:** sessions live in cookies (@supabase/ssr). Server code verifies with
  `getUser()` (a cookie is unverified input); client code uses
  `getUserFromSession()` (no network) and must handle its null. API routes use
  `requireApiUser` — bearer-first (the SolidWorks plugin has no cookie jar),
  cookie fallback. Never read tokens from localStorage.
- **`createPlannerSupabaseClient()` is browser-only.** On the server it returns
  a trap that throws on use. Construction during client-component SSR is fine;
  if you see its error, pass a per-request server client instead.
- **Values shared across the server/client boundary go in plain modules.** A
  constant exported from a `"use client"` file becomes a client-reference proxy
  in a server component and silently misbehaves (see
  src/lib/sop/workspace-cookie.ts for the pattern and the story).
- **Module-level mutable state in shared code must be keyed by client**
  (WeakMap), or it leaks across users on the server.
- **CSS:** feature styles go in a component/route-scoped file imported by the
  component that uses them — never into `app/globals.css`. Anything added to
  globals must live inside `@layer components` or it silently beats every
  Tailwind utility.
- **Controlled documents (SOP prints, DOCX) use `formatDateControlled`** — fixed
  MM/DD/YYYY by design. UI surfaces use `formatDate`/`formatDateTime` from
  `@/domain/formatting`. Do not add local copies.

## Process

- Branch per feature → CI green → merge to main → delete branch. No PRs
  (solo workflow); CI is the reviewer and nothing merges red.
- **Never commit a package-lock.json touched by Windows npm** (npm/cli#4828
  drops cross-platform optional deps). After adding/updating packages: dispatch
  the `relock.yml` workflow, commit its artifact. Discard incidental local
  lockfile changes.
- After any schema migration: `npm run gen:types`, commit the updated
  `src/lib/database.types.ts`.
- Renamed/deleted a root-level file and dev goes weird? Stop the server, delete
  `.next-dev`, restart.

## Deliberate decisions — do not "fix" these

- **SOP solo self-review test mode is RETIRED** (2026-07-25) — this note used to
  say the opposite, so read it before acting on anything that mentions it.
  `20260723133000` stubbed `sop_self_review_test_active()` to `select false`, made
  `enable_sop_self_review_test()` raise, and cleared the flag on every row; it was
  applied live 2026-07-25. `enableSopSelfReviewTest` and `soloSelfReviewReady` are
  already gone from the app. What remains is inert but NOT free to delete casually:
  the `sops.self_review_test` column, both RPCs, and `test_self` branches inside
  `enforce_sop_transition()` / `sign_sop()` that can never evaluate true. Removing
  the branches means patching those functions in place (see the rule above) — never
  a rewrite. See docs/deferred-work.md §1.
- react-hooks v7 compiler-era lint rules are pinned off in eslint.config.mjs
  with rationale; the classic rules stay on.
- `sop/numbering.ts`, `sop/version.ts` are pre-built, not dead. Decide to
  finish or delete them — don't garbage-collect them.
  (`schedule-import.ts` was the third: **decided 2026-07-21** — its sheet
  parsing became `domain/planning/schedule-row.ts`, its customer/template
  resolution was deleted in favour of SKU-keyed configs. See
  docs/superpowers/specs/2026-07-21-planning-schedule-to-work-order-design.md.)
- The unlayered scrollbar reset/restore pairs in globals.css must stay at the
  same cascade level. The `signedUrlCache` browser-only guard prevents
  cross-user URL leaks — never relax it.
