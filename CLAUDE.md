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

- `enableSopSelfReviewTest` / `soloSelfReviewReady` (SOP solo test mode) look
  unused/redundant; they are a live feature. See docs/deferred-work.md §1.
- react-hooks v7 compiler-era lint rules are pinned off in eslint.config.mjs
  with rationale; the classic rules stay on.
- `schedule-import.ts`, `sop/numbering.ts`, `sop/version.ts` are pre-built,
  not dead. Decide to finish or delete them — don't garbage-collect them.
- The unlayered scrollbar reset/restore pairs in globals.css must stay at the
  same cascade level. The `signedUrlCache` browser-only guard prevents
  cross-user URL leaks — never relax it.
