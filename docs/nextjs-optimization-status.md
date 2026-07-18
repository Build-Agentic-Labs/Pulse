# SOP and Next.js optimization status

Last updated: 2026-07-18

## Completed work

### SOP user interface

- Standardized typography, dropdowns, buttons, icons, spacing, and table alignment across the SOP module.
- Refined All SOPs, Review Queue, Effective Library, Retired SOPs, Departments, the SOP editor, annexes, and approvals.
- Simplified responsible-person entry and department approval configuration.
- Presented Quality approval consistently with other approval rows.
- Improved department and SOP client caching to avoid loading jumps during navigation.
- Corrected PDF preview worker resolution and verified attached PDF rendering.

### Next.js and browser performance

- Updated Next.js to 15.5.20 and resolved dependency advisories.
- Replaced the deprecated `next lint` command with the ESLint CLI.
- Enforced a zero-warning lint threshold.
- Removed the root `force-dynamic` setting and blanket document `no-store` header.
- Statically prerendered 17 page routes while retaining private, `no-store` API responses.
- Split the shared route shell into lazy dashboard, planner, planning, production, and mobile-capture chunks.
- Lazy-loaded SOP tab content while preserving mounted tab state.
- Added App Router loading, error, and not-found boundaries.
- Replaced raw image elements with `next/image`, using unoptimized rendering where signed, blob, or data URLs require it.
- Fixed React hook dependency warnings and removed unused client code.
- Loaded SOP workspace membership and org-tool permissions in parallel.
- Deduplicated simultaneous superadmin permission checks.
- Added optional Web Vitals reporting through `NEXT_PUBLIC_WEB_VITALS_ENDPOINT`.

## Measured results

| Route family | Before | Current |
| --- | ---: | ---: |
| Home, planner, planning, production, mobile capture | 339 kB | 196 kB |
| SOP workspace | 247 kB | 205 kB |
| Shared JavaScript | 103 kB | 103 kB |

Production verification confirmed static page cache hits and explicit private `no-store` behavior for API routes.

## Verification completed

- ESLint: zero warnings
- TypeScript typecheck: passed
- Vitest: 33 files and 336 tests passed
- Next.js production build: passed
- Browser checks: SOP departments, tab navigation, planner, mobile photo capture, optimized images, and SOP PDF preview
- Local development server: `http://localhost:3000`

## Remaining work

1. Configure a same-origin `NEXT_PUBLIC_WEB_VITALS_ENDPOINT` if production field metrics should be retained.
2. Decompose `app/globals.css` into route or feature styles and reduce broad global selectors.
3. Adopt cookie-based Supabase authentication with `@supabase/ssr`.
4. Move authenticated reads into server-compatible data access after cookie-based sessions are available.
5. Plan and execute the Next.js 16 migration after the current baseline is stable.

## Current repository state

The optimization work was merged into `main` in merge commit `e779ce5`.
