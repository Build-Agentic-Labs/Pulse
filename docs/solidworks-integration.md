# SolidWorks Exploded-View Integration

Engineers auto-generate exploded views of assemblies in **SolidWorks**, tweak them by hand, and push
the rendered images onto **Pulse** manufacturing-step work instructions, where they appear beside the
step photos.

Because Pulse is a cloud web app and the SolidWorks API is a Windows-only in-process desktop API, the
integration is **two halves** that meet at a small HTTP contract:

```
SolidWorks plugin (C# add-in, on the engineer's PC)        Pulse (Vercel + Supabase)
  uses the SolidWorks API:                                    app/api/solidworks/*
   open assembly → read BOM/tree/custom props                   ├ GET  targets          (picker feed)
   → auto-build explode → engineer tweaks → render PNG          ├ POST exploded-view    (image ingest)
   → (optional) motion study → render MP4/WebM                  └ POST build-animation  (video ingest)
  "Send to Pulse" panel: login → pick Project→Task ───HTTP──► Storage + step_exploded_views/task_videos + UI
```

---

## Part A — Pulse side (this repo, implemented)

| Piece | Location |
| --- | --- |
| Domain model + helpers | `src/domain/step-exploded-views.ts` (`ExplodedView`, `getTaskExplodedViews`/add/upsert/remove, `normalizeComponents`) |
| DB table + realtime | `supabase/migrations/20260617120000_step_exploded_views.sql` (table, reuses the `step-photos` bucket), `20260617130000_step_exploded_views_rls.sql` (authenticated per-project RLS, mirrors `step_photos`), `20260617140000_step_exploded_views_task_level.sql` (`step_id` nullable) |
| Data-layer wiring | `src/domain/supabase-planner.ts` — row mapper, signing, indexing by task, hydration into `task.customFields["taskExplodedViews"]` on both loaders, realtime registration, `saveExplodedViewToSupabase` |
| Ingest endpoint (images) | `app/api/solidworks/exploded-view/route.ts` |
| Ingest endpoint (videos) | `app/api/solidworks/build-animation/route.ts` (task-level build animations → `task-videos` bucket + `task_videos` table) |
| Picker feed | `app/api/solidworks/targets/route.ts` |
| Viewer | `src/components/step-exploded-view-gallery.tsx` and `src/components/task-video-gallery.tsx`, shown in the planner procedure editors (`line-workspace.tsx`) and the operator mobile portal (`mobile-photo-portal.tsx`) |

Exploded views attach at the **task level** (one gallery per procedure task, shown in the task header
next to the Operators metric), not per step. They are stored as a flat array in
`task.customFields["taskExplodedViews"]` but NOT written into `tasks.custom_fields` on save (stripped
by `customFieldsRow`) — the `step_exploded_views` table is the source of truth, hydrated into
`customFields` on load (the step-photos pattern). The table keeps its name for history; its `step_id`
column is unused (`null`) for these task-level rows.

---

## HTTP contract (source of truth for the plugin)

All requests send `Authorization: Bearer <supabase_access_token>` (see Auth below). RLS scopes every
read/write to the projects the account may access.

### `GET /api/solidworks/targets`
List accessible projects for the Project picker:
```json
{ "projects": [ { "projectId": "…", "projectName": "…", "workspaceId": "…", "workspaceName": "…" } ] }
```

### `GET /api/solidworks/targets?projectId=<id>`
A project's tasks (across all scenarios) for the Task picker; milestone/inspection rows are excluded:
```json
{
  "project": { "projectId": "…", "projectName": "…", "workspaceId": "…", "workspaceName": "…" },
  "tasks": [ { "id": "…", "name": "Install drive", "code": "ASM-Z1-10", "scenarioName": "Main Plan" } ]
}
```
`403` if the account can't see the project.

### `POST /api/solidworks/exploded-view`
`multipart/form-data` with two fields:
- `file` — the rendered image (`image/png|jpeg|webp`, ≤ 10 MB).
- `meta` — JSON:
  ```json
  {
    "projectId": "…", "taskId": "…",
    "fileName": "Exploded view 1", "caption": "…",
    "solidworksFilePath": "C:/vault/ASM-1000.SLDASM",
    "explodeConfigName": "Manufacturing_Explode_01",
    "frameNumber": 1, "components": ["PN-1000", "PN-1001"]
  }
  ```
  `taskId` and `projectId` are required (`projectId` scopes the storage path and the RLS access check).

Response `{ "explodedView": { id, name, dataUrl, caption, solidworksFilePath, explodeConfigName,
frameNumber, components, … } }` — `dataUrl` is a signed URL (the bucket is private). Errors: `400`
bad form, `403` wrong project, `413` too large, `415` bad type, `429` rate-limited. Free-text
metadata (`fileName`, `caption`, `solidworksFilePath`, `explodeConfigName`) is truncated to 500
chars; `frameNumber` must be a non-negative number.

### `POST /api/solidworks/build-animation`
Task-level build animations (motion-study videos), same shape as the exploded-view ingest.
`multipart/form-data` with two fields:
- `file` — the rendered video (`video/mp4|webm`, ≤ 200 MB).
- `meta` — JSON:
  ```json
  {
    "projectId": "…", "taskId": "…",
    "fileName": "Build animation 1", "caption": "…",
    "solidworksFilePath": "C:/vault/ASM-1000.SLDASM",
    "durationSeconds": 42.5
  }
  ```
  `taskId` and `projectId` are required (`projectId` scopes the storage path and the RLS access check).

Response `{ "video": { id, name, videoUrl, caption, solidworksFilePath, durationSeconds, … } }` —
`videoUrl` is a signed URL (the bucket is private). Errors: `400` bad form, `403` wrong project,
`413` too large, `415` bad type, `429` rate-limited. Free-text metadata (`fileName`, `caption`,
`solidworksFilePath`) is truncated to 500 chars; `durationSeconds` must be a non-negative number.

---

## Auth — service account (A5, ops, no code)

The plugin is headless, so it cannot use the browser Supabase Auth flow the phone portal uses. Instead:

1. Create one Supabase user, e.g. `solidworks-bridge@<yourdomain>`.
2. Add it as an **edit** member of each workspace/project whose tasks should receive views (existing
   access model — see the user-access memory).
3. The plugin signs in with email/password via Supabase Auth REST
   (`POST {SUPABASE_URL}/auth/v1/token?grant_type=password`) to obtain an `access_token` (+ refresh
   token), stores the refresh token in **Windows Credential Manager**, and refreshes as needed.

No change to `src/lib/api-auth.ts` is required — it validates any Supabase user JWT, and RLS does the
authorization.

---

## Verifying the Pulse side (no SolidWorks needed)

`scripts/solidworks-mock-bridge.mjs` performs the full plugin handshake — sign in → list targets →
upload a placeholder PNG to a step. After it runs, open the planner/mobile portal on that step and the
view should appear live (realtime).

```bash
PULSE_BASE_URL=http://localhost:3000 \
SUPABASE_URL=… SUPABASE_ANON_KEY=… \
SW_BRIDGE_EMAIL=solidworks-bridge@… SW_BRIDGE_PASSWORD=… \
node scripts/solidworks-mock-bridge.mjs
```

Also run the standard gates: `npx tsc --noEmit`, `npx vitest run` (includes
`src/domain/step-exploded-views.test.ts`).

---

## Part B — SolidWorks plugin (separate C# repo, design)

> Cannot be built or tested in this repo (no SolidWorks, no .NET desktop toolchain). This is the spec
> to hand to the C# effort.

**Type:** SolidWorks add-in implementing `ISwAddin`, with a Task Pane UI.
**Stack:** C#, .NET Framework 4.8, SolidWorks API interop (`SolidWorks.Interop.sldworks`), **SolidWorks
2022+**, licensed install required.

### Modules
1. **Connection** — attach to the running `ISldWorks`; get the active `IAssemblyDoc`.
2. **Traversal / BOM** — recurse the `IComponent2` tree; read `IBomTable` + the Custom Property Manager.
3. **Auto-explode engine** — create `IExplodeStep`s using this priority order:
   1. Custom properties: `Explode_Group`, `Explode_Direction` (`X+`/`Y-`/`Z+`/`Radial`/`Mate`),
      `Manufacturing_Sequence`, `Explode_Distance`, `Show_In_Explode`.
   2. Native sub-assembly grouping from the BOM tree.
   3. Smart fallback: bounding-box separation, mate-axis direction, radial.
4. **Tweak** — the engineer adjusts the explode in SolidWorks; the plugin re-reads the active config.
5. **Render / export** — PNG/JPG via `IModelDocExtension.SaveAs`; step-by-step image sets; (later) PDF
   with callouts and motion-study AVI. Emit the metadata JSON below.
6. **Pulse client** — Supabase login + token in Windows Credential Manager; `GET …/targets` for the
   picker; `POST …/exploded-view` (multipart) to send. Map one render → one `frameNumber`.

### Recommended CAD custom properties
`Explode_Group` (string), `Explode_Direction` (string), `Manufacturing_Sequence` (int),
`Explode_Distance` (double, optional), `Show_In_Explode` (yes/no).

### Plugin phases
- **P1** — connect → capture the current (engineer-made) explode → upload. Proves the contract.
- **P2** — auto-explode from custom properties + sequence-ordered frames; engineer tweak loop.
- **P3** — motion studies, PDF with callouts, override UI, per-task config memory
  (`task.customFields["solidworksLink"]`).

The HTTP contract above is the stable interface between the halves; everything in Part B is verified on
a SolidWorks workstation, out of scope for this repo.
