# Performance checks

Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and
`npm run check:bundles`. Finish a build before running standalone typechecking;
Next generates route types during the build. Development uses `.next-dev` and
production builds use `.next`.

CI builds with placeholder public Supabase configuration and enforces gzip
budgets of 160 KiB per JavaScript chunk and 350 KiB for the referenced client
entry code of Product, SOPs, and Planning. Entry budgets exclude deferred feature
chunks; these measurements are artifact sizes, not total network transfer or
page-load timings. Investigate a budget failure before raising a limit.

Production browsers send LCP, INP, CLS, FCP, and TTFB to `/api/performance`.
Filter hosting logs for `"event":"web-vital"` and group by metric and route.
The collector records metric values and route shapes, strips query parameters
and dynamic project/document IDs, and omits resource entries. Development does
not report metrics. A custom HTTPS collector can be configured using
`NEXT_PUBLIC_WEB_VITALS_ENDPOINT`; its origin is included in the connection policy.
This public setting is applied at build time.

Planner calculation snapshots are local to each workspace component. Instruction
text and part-mention edits reuse scheduling results; live task content remains
the source for display and saving. Core confirmation still gates autosave, and
private-media hydration only merges media fields into the current task.

List and planner graph loaders paginate internally with deterministic ordering;
child queries also bound their ID filters. They return complete collections and
throw on any failed page, preserving the existing scrolling/filtering UI. This
prevents default API row-limit truncation but does not make total collection
transfer constant-size. Visible pagination and large-editor virtualization remain
separate product changes. Real-user latency, database query plans, and hosting
region alignment must be measured in the deployed environment.
