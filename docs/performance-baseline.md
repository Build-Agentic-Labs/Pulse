# Browser performance baseline

Measured on 2026-07-18 with Next.js 15.5.20 using `npm run build`.

## Route output

- 17 page routes are statically prerendered. API routes and parameterized project, SOP, and work-order routes remain dynamic.
- Static page responses report `x-nextjs-cache: HIT`, `x-nextjs-prerender: 1`, and `Cache-Control: s-maxage=31536000`.
- API responses explicitly report `Cache-Control: private, no-store, max-age=0`.

## Initial JavaScript

| Route family | Before | Current |
| --- | ---: | ---: |
| Home, planner, planning, production, mobile capture | 339 kB | 196 kB |
| SOP workspace | 247 kB | 205 kB |
| Shared by all routes | 103 kB | 103 kB |

The reduction comes from route-level dynamic imports and lazy SOP tab chunks. Heavy planner and capture code is no longer part of unrelated route entry bundles.

## Verification

Run these checks after changes that affect routing, providers, or shared imports:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

To collect field metrics, set `NEXT_PUBLIC_WEB_VITALS_ENDPOINT` to a same-origin POST endpoint. The root reporter sends the standard Next.js Web Vitals payload plus the path and recording timestamp.

## Remaining constraint

Supabase sessions currently persist in browser storage. Authenticated data cannot move into server components safely until the app adopts a cookie-based request session, such as `@supabase/ssr`. Client-side stores already share one Supabase client and deduplicate concurrent membership and permission requests.
