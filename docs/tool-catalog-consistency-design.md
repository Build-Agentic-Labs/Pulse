# Tool catalog consistency: design proposal

Status: **proposal for review, 2026-10-03; amended the same day (§5a). Nothing here is implemented or applied.** No migration has been written, and no schema, permission or data change has been made.

The zero-zone save defect in §1.3 was fixed separately in `33b2797`.

Goal: make catalog **rename**, **delete** and **tidy** change the tool library and every step reference together, atomically, and keep them consistent afterwards.

## 1. Verified current behavior (real database)

### How it was verified

The check ran against the retained isolated database (`scratch/browser-db`, started without a reset, stopped afterwards with volumes kept). It drove the real Setup › Tools catalog in the e2e build (current branch, `8b14112`).

The fixtures were disposable:
- a fresh workspace, an `editor` member and a product made with `create_project_with_starter_plan`
- one task and one step
- `step_tools` rows "Torque Wrench", "Hex Key" and "needle  nose pliers"
- library rows for the first two, using the exact ids the client computes

The spec was temporary and is not committed.

### Results

| Step | Screen | `step_tools` (stored) | `tool_library` (stored) |
|---|---|---|---|
| Seeded | Torque Wrench, Needle Nose Pliers, Hex Key | Torque Wrench, Hex Key, needle  nose pliers | Torque Wrench, Hex Key |
| Rename "Torque Wrench" → "Torque Driver" (reported success) | Torque Driver, … | **Torque Wrench**, unchanged | **Torque Driver *and* Torque Wrench** |
| Delete "Hex Key" | **"Save failed"** | unchanged | unchanged |
| Tidy | **"Save failed"** | unchanged | unchanged |
| Reload | **Torque Wrench**, Needle Nose Pliers, Hex Key; "Tidy names (1)" still offered | | |

### Findings

1. **A successful rename never reaches the step references.** It is reverted on reload. The cause is that `savePlannerShellToSupabase` strips `stepToolLists` from the task row and never writes `step_tools`.
2. **An editor's rename leaves the old library row behind.** `upsertToolLibraryMetadata` deletes the old row, but the `tool_library` DELETE policy allows only workspace `owner`/`admin`. Under RLS a disallowed delete affects 0 rows without raising an error, so the client reports success.
   - The library now holds both names.
   - The new name's row is invisible in the catalog, because the catalog lists only tools in use.
   - The live policies were confirmed in `pg_policies`.
3. **Delete and tidy failed outright, in a separate defect.** On a product with **no zones** whose tasks already point at a saved "Unzoned" station, `normalizeTaskPlanningContext` (`src/domain/task-planning.ts`, since `8b32966`, 2026-05-28, on `main`) emits that station twice:
   - once as the generated Unzoned station
   - once as a pass-through in-use station

   The `stations` upsert then fails with Postgres `21000` ("ON CONFLICT DO UPDATE command cannot affect row a second time").

   **This is not catalog-specific.** On the reloaded zero-zone product, a plain product-name edit's normal autosave failed the same way. That write was *partial*: `products` was stored, and everything after `stations` (task rows included) was not.

   It is a data-loss risk for zero-zone products: Gantt edits fail to save after the first reload. **Fixed separately in `33b2797`** (see the ledger in `docs/workspace-structure-plan.md`). The shell save itself is still a non-atomic sequence of requests.

   The catalog design below removes the catalog's dependence on the shell save, so catalog operations would no longer hit it.

### Also confirmed by reading code and migrations (not exercised)

- **Mobile "Restore Step" erases step tool assignments.** It calls `savePlannerStateToSupabase`. That function's `replace_task_children` RPC (`20260601128000…sql:41`) deletes every step of the scenario's tasks, which cascade-deletes `step_tools`, and it never rewrites them.
- **The Gantt reorder misuses the shared shell-save lock.** It sets `saveInFlightRef` without checking it (`line-workspace.tsx:3801`) and clears it in `finally`. It can therefore release a lock held by a running shell save.

## 2. Existing semantics the design must keep

- **Identity is the canonical key.**
  - `canonicalToolKey` = `formatToolName` (NFC; strips zero-width characters; collapses spaces; converts units such as `1/2"`→`1/2in`; applies acronym and small-word casing), then folds hyphens and spaces and lowercases.
  - One catalog entry merges every raw spelling with the same key (`buildProjectToolCatalog`).
  - Rename and delete act on all of those spellings (`renameToolInTasks` / `removeToolFromAllTasks`).
- **Delete removes step assignments.** The confirmation reads "This removes the tool from N step assignment(s) across M task(s)." The library row goes too.
- **Rename onto an existing tool merges them.** Per step, duplicates are folded case-insensitively. There is no collision prompt.
- **Tidy is a batch rename** of each messy spelling to `formatToolName(raw)` (`planToolNameTidy`). Today it looks only at the first-seen spelling per key, and only in the loaded scenario.
- **The library row carries the metadata:** category and image. Today a rename moves the old row's image onto the target and takes the category from the draft.
- **Stored ids are computed by the client and must keep that format**, because later writes depend on them:
  - `step_tools.id = 'tool-' || safe(step_id) || '-' || safe(lower(trim(name)))`
  - `tool_library.id = 'tool-library-' || safe(project_id) || '-' || safe(lower(trim(name)))`
  - `safe` replaces `[^a-zA-Z0-9._-]` with `-`.
  - **Why the format matters:** `removeStepToolFromSupabase` deletes by computed id, and every `sync…` upserts by id and deletes rows whose id it did not compute. A row whose id does not match its name would be skipped by removals, and would make syncs violate `step_tools_step_tool_name_idx (step_id, lower(tool_name))`.

## 3. Recommendation: two atomic RPCs and a read RPC

All three are `SECURITY INVOKER`, use `set search_path = ''`, `revoke all … from public, anon`, and `grant execute … to authenticated`. This follows `save_awi_procedure` (`20261003180653`).

```
public.list_project_tool_usage(p_project_id text)
  returns table (tool_name text, step_count int, task_count int, scenario_count int)
  -- read-only; every distinct stored spelling in the project, with usage

public.rename_project_tools(p_project_id text, p_renames jsonb)
  -- p_renames: [{ "from": ["torque  wrench","Torque Wrench"], "to": "Torque Driver", "category": "torque" | null }, ...]
  -- one item = catalog rename; many items = tidy
  returns jsonb  -- { steps: [{task_id, step_id, tools: [..]}], library: [rows], removed_storage_paths: [..] }

public.delete_project_tool(p_project_id text, p_names text[])
  returns jsonb  -- same shape
```

### Why matching uses exact spellings sent by the client

The normalization rules live in TypeScript. Copying them into SQL would drift. So the client:
1. calls `list_project_tool_usage`
2. computes canonical keys locally
3. sends the **exact stored spellings** to change

The RPC matches `lower(tool_name) = any(lower(from))`, which is exact and case-insensitive, as the unique index is.

If a new spelling is added between the list and the mutation, it is simply left alone. It shows up as its own catalog entry and can be tidied. Nothing is corrupted.

### Scope

**Every step of every task in every scenario of the project's product(s), plus that project's `tool_library` rows.** The query path is:

```
tasks t
  join scenarios s on s.id = t.scenario_id
  join products p on p.id = s.product_id
where p.project_id = p_project_id
```

- The library is project-scoped, so renaming it in one scenario would orphan the others.
- AWI masters are their own projects, so they are unaffected.

**Decision for you:** scenarios are "independent snapshots", and `duplicate_scenario` deliberately does not copy tools. If renames should stay inside the active scenario, the library row can only move when no other scenario still uses the old name. That is a weaker guarantee; I recommend project-wide.

### Inside one transaction (rename)

1. **Checks and serialization:**
   - `auth.uid()` is not null.
   - `has_project_access(p_project_id, 'edit')` holds, otherwise `42501`.
   - The product's `project_id` is not null.
   - Inputs are validated: non-empty, trimmed `to`; at most N items; otherwise `22023`.
   - `pg_advisory_xact_lock(hashtext('tool-catalog:' || p_project_id))` serializes catalog operations per project.
2. **Per affected step,** in sequence order:
   - If the step already has the target name: delete the source rows (a merge).
   - Otherwise: delete the source row and insert the target with the **client-format id**, keeping its `sequence`.
   - Use `on conflict (step_id, lower(tool_name)) do nothing`, so a concurrent insert of the target merges instead of failing.
3. **Library:**
   - If an old row exists and no target row exists: **update it in place**, setting the new id, `tool_name` and `category` (UPDATE is allowed for workspace editors).
   - If a target row exists: update its category, keep its image unless it has none (then take the old row's), and delete the old row. **This needs the existing DELETE permission** (see §4).
4. **Return** the final tool list of every affected step, the final library rows, and any storage paths of library rows that were removed.

**Delete** is the same shape: delete the matching step rows and the library row. **Tidy** is a rename call with many items.

### Idempotence

All three operations are idempotent. Re-running a rename after it already committed matches nothing and succeeds. So if a response is lost after commit, the client can retry safely.

### Ids in SQL

A `private.tool_segment(text)` helper replicates `safe(lower(trim(x)))`. Parity with the TypeScript id functions is pinned by one shared fixture table, tested in both pgTAP and vitest: spaces, punctuation, hyphen and space look-alikes, mixed case.

One known divergence: astral (non-BMP) characters become two dashes in JavaScript (one per UTF-16 unit) but one in Postgres. The RPC should reject names that need such characters (`22023`) rather than write an id the client cannot reproduce.

## 4. Authorization and cross-workspace protection

### Why not `SECURITY DEFINER`

Using `SECURITY INVOKER` means existing RLS still applies to every row the function touches. A row in another workspace cannot be written even with a hostile `p_project_id`, and `has_project_access` is checked explicitly first, giving a clear `42501`.

Only `p_project_id` and names come from the client. Step rows are found by joining through the project, never from client-supplied ids.

### Permission inconsistency (today)

The current policies disagree, and I am **not proposing to change them** (that needs separate approval):

| Table | Insert / update | Delete |
|---|---|---|
| `step_tools` | per-project `edit` | per-project `edit` |
| `tool_library` | workspace `owner` / `admin` / `editor` | **workspace `owner` / `admin` only** |

### What the RPC does under the current rules

Inside the RPC, every library delete checks `get diagnostics … row_count` and **raises `42501` when an existing row was not deleted**. That turns today's silent partial success into an explicit, fully rolled-back failure.

In practice, for workspace editors:
- A plain rename succeeds (update in place).
- A merge-rename and a delete of a tool *that has a library row* fail with a permission message.
- Today both of those appear to work but change nothing durable.

**Optional follow-up (needs approval):** align `tool_library` write policies to `has_project_access(project_id, 'edit')`, matching `step_tools`.

## 5. Concurrency: what a transaction does not solve

The RPC commits atomically, but **later writes from clients holding stale lists can undo it**. These are the competing `step_tools` writers:

| Writer | Kind | Effect after a committed rename |
|---|---|---|
| Desktop add/remove tool (`persistAdd/RemoveStepTool`) | one row by computed id | Removing the old name deletes nothing (the user's removal is lost). Adding the old name re-creates it as a separate tool. |
| **Desktop Gantt reorder** (`saveTasksToSupabase` → `syncStepToolsForTasks`) | **full list from local state** | **Re-inserts the old name and deletes the renamed row** for every reordered task. |
| **Mobile:** task rename, add process, reorder (`saveTask(s)ToSupabase`), step delete (`saveTaskWithManufacturingStepsToSupabase`, empty-wipe), draft autosave and retry (`syncStepToolsForStepToSupabase`, including drafts replayed from IndexedDB) | **full lists from the phone's copy** | Same undo for those tasks or steps. |
| Mobile Restore Step (`savePlannerStateToSupabase`) | cascade delete | Erases all step tools (a pre-existing bug, independent of catalog operations). |
| Another tab or user doing any of the above | | Same. |

### Does the shared save lock help?

No. `saveInFlightRef` would not close this race:
- **It is per tab and per component.** Other tabs, other users and the mobile portal (which has its own lock) never see it.
- **Most competing writers don't take it.** Even in the same tab, `persistAdd/RemoveStepTool`, the procedure queue, step moves and media deletes don't take it.
- **The Gantt reorder doesn't respect it.** It takes the lock without checking and releases it unconditionally.
- **It only orders writes in one tab.** It cannot make an already-stale list correct.

### Proposed mitigations, in order of value

1. **Stop syncing tools from saves that do not change tools.** The Gantt reorder and mobile task rename, add-process and reorder change `wbs`, zone, station or name only. Give them a task-row-only save (`saveTaskRowsToSupabase`, without `syncStepToolsForTasks`).
   - This removes the desktop's only full-list tool write and most mobile ones.
   - It is a narrow change with no visible effect.
2. **Make the remaining tool-editing syncs diff-based.** This covers mobile draft autosave, retry and step delete. Instead of "make the stored list equal my list", send "add these names, remove these names" relative to the base list the client loaded. A stale client then cannot resurrect or delete names it did not touch. *(Mobile change; phase B.)*
3. **Converge the other clients:**
   - `step_tools` is already realtime (FULL replica identity), and the desktop merges server tool lists on refresh.
   - Add a `tool_library` subscription. Today it is in the type union but never subscribed, so other desktops keep a stale catalog until reload.
4. **Leave the old-name re-add as a visible outcome.** The server cannot tell intent. A per-row add of the old name after a rename creates a separate catalog entry that can be merged again. I propose documenting this rather than adding an alias table.

~~With (1)+(3) in phase A, the remaining window is a phone that edited tools on a stale copy, which phase B closes.~~ Superseded by §5a.

## 5a. Amendment: Phase A alone is not enough

**Phase A, as first proposed, remains vulnerable.** A committed catalog operation can be silently undone while *any* desktop or mobile path can write a step's tool list from stale state. The same is true of any path that wipes tool rows and does not restore them. The atomic RPC guarantees only that a catalog operation lands whole; it cannot protect that result from a later stale write.

Phase A covered the desktop Gantt reorder and the mobile task-row saves. It left these overwriting paths in place:
- mobile draft autosave and its IndexedDB replay
- mobile failed-save retry
- mobile step delete
- mobile Restore Step

So shipping Phase A by itself would ship a catalog that a phone can revert.

### Minimum complete rollout

Every path that currently writes a whole tool list, or wipes tool rows, must stop before catalog operations ship. Call sites were checked on 2026-10-03.

**Step 1: no stale list writers.** Client only; no schema change. Ship this first; it is useful on its own.

| Path | Today | Required change |
|---|---|---|
| Desktop Gantt reorder (`line-workspace.tsx:3811-3815`) | `saveTasksToSupabase` → `syncStepToolsForTasks`: full lists from local state | Task-row-only save (`saveTaskRowsToSupabase`); never touches `step_tools` |
| Mobile reorder (`mobile-photo-portal.tsx:2322-2323`) | same | Task-row-only save |
| Mobile task rename (`:2139`, `saveTaskToSupabase`) | full-task tool sync | Task-row-only save |
| Mobile add process (`:2208`, `saveTaskToSupabase`) | full-task tool sync | Task-row-only save, plus per-row inserts for any tools the new task is created with |
| Mobile step delete (`:2891`, `saveTaskWithManufacturingStepsToSupabase` → `syncStepToolsForTask(allowEmptyWipe)`) | rewrites every remaining step's tools; an empty list wipes the task | Write the steps without a tool sync. The deleted step's tools go by FK cascade; the other steps' tools are untouched. |
| Mobile draft autosave (`:2012`) and failed-save retry (`:2565`), both `syncStepToolsForStepToSupabase`, including drafts replayed from IndexedDB | makes the stored list equal the draft's list | **Diff-based.** Record the tool list when the draft starts, and send only the adds and removes since then as per-row writes (both idempotent). A replayed draft carries those operations, not a list. |
| **Mobile Restore Step** (`:2089`, `savePlannerStateToSupabase(snapshot)`) | the `replace_task_children` RPC deletes every step of every task in the scenario (cascade-deleting **all** their `step_tools`) and never rewrites tools; also a full-state save, which CLAUDE.md forbids for new work | **Targeted restore:** re-insert only the deleted step (step row, then its tools and photos as per-row inserts) into its task. No full-state save. This also fixes today's data loss: Restore currently erases every tool assignment in the scenario. |
| Desktop optimizer (`line-workspace.tsx:3019`, `savePlannerStateToSupabase`) | writes only into a freshly duplicated scenario; `duplicate_scenario` copies no tools, so there is nothing to overwrite | Unchanged; recorded so the inventory is complete |
| Per-row add/remove (desktop `use-workspace-tools.ts:114/135`, mobile `:2519/:2542`) | single rows by computed id | Unchanged. These are already diff-shaped (the residual old-name re-add is documented in §5). |

**Step 2: atomic catalog operations.**
- The migration from §3 (additive).
- `gen:types`.
- The desktop catalog client from §6.
- A `tool_library` realtime subscription.

**Step 3: ~~guard the rollout window by waiting for clients to reload~~.** Superseded by the enforceable fence in §5b. Waiting is not enforceable:
- The app has no deploy-version check; the only service worker is for push notifications.
- A tab or phone runs its loaded code until it reloads.

After §5b, the remaining interactions are the per-row cases in §5 (a stale add of the old name re-creates it as a separate, visible tool). No path, old or new, can silently undo a committed rename or delete.

**Separate decision:** the reorder's lock handling should check and queue (or use its own key) rather than clobber `saveInFlightRef`. This is independent of the catalog and is reported here only.

## 5b. Old-client compatibility: an enforceable write fence (proposal)

Decisions confirmed on 2026-10-03: project-wide scope; current permissions kept, with clear refusal errors; unsafe competing writers removed before catalog operations are enabled.

### The gap

Old code keeps running in open desktop tabs and on phones, and cannot be changed. Facts checked on the retained database and in the code:
- Every `step_tools` write comes directly from clients, or from FK cascades when steps or tasks are deleted. **No database function writes `step_tools`.**
- Old clients write it four ways:
  1. per-row add/remove by computed id
  2. full-list syncs (Gantt reorder; mobile task saves, draft autosave, retry and step delete)
  3. cascades through `replace_task_children` (old mobile Restore)
  4. step moves (an `update` of `task_id` only)
- **Mobile drafts survive refused saves.** The IndexedDB recovery draft (`MobileNewStepDraftRecord`: a full `tools` list, no base list) is cleared only after a fully successful save (`mobile-photo-portal.tsx:2021-2034`). A refused tool write leaves it on the phone, and the next load replays it.

### Mechanism: every tool write goes through an RPC, and the table refuses direct writes

1. **`public.apply_step_tool_changes(p_task_id text, p_step_id text, p_add text[], p_remove text[]) returns text[]`** (additive)
   - `SECURITY INVOKER`, `search_path ''`; the same rule as today's RLS (`has_project_access(task_project_id(task), 'edit')`, else `42501`), and the step must belong to the task
   - diff-based and idempotent:
     - adds insert with the client-format id `on conflict (step_id, lower(tool_name)) do nothing`
     - removes delete by `step_id` and `lower(tool_name)`, not by id
   - returns the step's resulting list
   - it never takes a whole list, so a stale caller can only add or remove the names it names
2. **Tool-write flag.** This RPC, the catalog RPCs and the Restore RPCs (`docs/restore-step-design.md`) run `set_config('pulse.tool_write', 'rpc', true)` before touching `step_tools`.
   - It is transaction-local; PostgREST exposes no `set_config`, and each request is its own transaction.
   - This is a client-version fence, not a security boundary. RLS still authorizes every row.
3. **Fence trigger `step_tools_write_fence`** (BEFORE INSERT, UPDATE or DELETE, FOR EACH ROW, on `step_tools`). It allows a write when any of these hold:
   - the flag is `rpc`
   - `pg_trigger_depth() > 1`: an FK cascade from deleting a step or task (pgTAP must pin this depth behavior)
   - an UPDATE changes only `task_id` and `updated_at` (step move; not a list overwrite)
   - **a restatement of what is already stored:**
     - an INSERT whose row already exists identically (same `id`, `task_id`, `step_id`, `tool_name`)
     - the UPDATE that `on conflict` then performs, changing only `sequence` or `updated_at`

     So an old client whose list matches the server writes nothing new and is not refused. Only divergent writes are: new names, and deletes.
   - `current_user` is not `authenticated` or `anon` (migrations, service role)

   Otherwise it raises `42501` with the message **"This page is out of date. Reload to keep editing tools."** and hint `pulse:client-outdated`.

   It is a trigger, not a grant change, because grants are not durable here (seed.sql re-grants).
4. **`replace_task_children` guard** (from the Restore design): refuse when it would delete existing step tools, photos or exploded views. This closes the old-Restore cascade wipe, which a row trigger cannot tell apart from a legitimate delete.

### What old clients experience once the fence is live

Every old write path fails **loudly**, never silently. The existing error surfaces show the server message unchanged: the desktop "Save failed" toast body, and the mobile error banner.

| Old path | Result |
|---|---|
| Desktop or mobile per-row add/remove | refused, with the reload message |
| Desktop Gantt reorder | If the tab's tool lists match the server: the sync only restates rows, so it is allowed and the reorder succeeds. If they diverge (for example after a catalog rename): the tool sync is refused **after the first of the reorder's two task saves**, which wrote temporary `tmp-…` WBS values. The second save, restoring real WBS values, never runs. The tab shows "Save failed" with the reload message, and its next shell save rewrites the real WBS values. But if the tab is closed first, **temporary WBS values stay stored**. This is a known residual partial write of the old reorder (it is not atomic today either). It is detectable with a read-only `wbs like 'tmp-%'` query; there is no automatic repair or cleanup without approval. |
| Mobile task rename, add-process | task rows save; the tool sync is allowed if it only restates stored rows, otherwise refused with the reload message |
| Mobile reorder | same two-save shape as the desktop reorder, with the same residual `tmp-…` WBS risk when lists diverge |
| Mobile draft autosave and retry | step text saves; the tool sync is refused; **the draft stays in IndexedDB**, and its retry keeps failing until the phone reloads |
| Mobile step delete | the step is deleted and its rows cascade (allowed); the follow-up full-task tool sync is refused. *(Its stale overwrite of sibling step text is not a tool write and remains until the Restore fix ships.)* |
| Mobile Restore Step | refused by the `replace_task_children` guard |

No old client can overwrite another user's or a catalog operation's tool assignments. The cost is loud refusals, plus the old reorder's residual temporary WBS values described above, on divergent lists only.

### Preserving offline drafts in the new client

- **New draft format (`formatVersion: 2`):** add `toolBase` (the server list when the draft began) and pending `toolOps {add, remove}`. Replay sends the ops through `apply_step_tool_changes`. The IndexedDB database version and keyPath are unchanged; only the record shape grows.
- **Legacy drafts** (no `formatVersion`, written by old code) are replayed conservatively:
  - text, checks and photos as today
  - tools: **add only** the draft names whose canonical key is missing on the server; **never remove**, since the base is unknown
  - if the server list has names the draft lacks, keep them and show a notice: "Tools removed in your offline draft were kept. Review this step." (**new visible text; needs approval**)
  - the draft is cleared only after this succeeds, as today

### Deployment order (the fence comes after every new-client path exists)

| Stage | Contents | Acceptance criteria |
|---|---|---|
| **M1** migration (additive) | `apply_step_tool_changes`; the Restore RPCs, table and `replace_task_children` guard (Restore design R1) | pgTAP: access, idempotence, add/remove by name, merge on conflict; the full browser suite still green |
| **C1** client | every tool write through `apply_step_tool_changes` (desktop and mobile per-row writes, draft v2, legacy draft handling); §5a Step 1 (no list writers); the Restore client (R2); mapping of `pulse:client-outdated` to the reload message | vitest and e2e: no client code path writes `step_tools` directly (enforced by a source check, as `check:bundles` does for harness code); the legacy-draft e2e keeps server-only tools and adds draft-only tools |
| **M2** migration | the fence trigger | pgTAP: direct inserts of new rows, divergent updates and deletes as `authenticated` are refused; identical restatements, cascades, `task_id`-only moves, the RPC and the service role are allowed. e2e on the retained database: an **old-client simulation** (direct PostgREST writes as the old code issues them) is refused with the reload message, and stored rows are unchanged. The full browser suite on the new client stays green. |
| **M3 + C2** | catalog RPCs (§3), catalog client (§6), `tool_library` realtime | the catalog acceptance tests in §9, plus: after a committed rename, an old-client full-list sync is refused and the rename survives a reload |

- **Rollback:** `drop trigger step_tools_write_fence` restores today's permissive behavior instantly. The RPCs are additive and can stay.
- **Ordering rule:** M2 must not ship before C1 is live, or new clients would be refused too. Catalog operations (C2) are enabled only after M2.

### Changes needing approval

**Database:**
- the `apply_step_tool_changes` RPC
- the `step_tools_write_fence` trigger
- the `replace_task_children` guard
- the deleted-steps table and Restore RPCs (Restore design)
- the catalog RPCs (§3)

No permission semantics change: every RPC applies today's `step_tools` rule, and `tool_library` keeps its current policies with explicit refusals.

**Visible:**
- Old clients show "This page is out of date. Reload to keep editing tools." on tool edits, and on reorders and mobile task saves that include a tool sync.
- The legacy-draft notice.
- The Restore errors (Restore design §2).
- Project-wide delete counts (§10).

**Optional, not required for enforcement:** a "New version available — reload" banner driven by a version endpoint. It needs approval as a new visible element.

## 6. Applying the confirmed result on the client

- **Catalog operations stop calling `savePlannerShellToSupabase`.** This removes them from the destructive diff-save and from the zero-zone failure. The confirmed-state and view-only gates stay as they are.
- **Optimistic, then confirmed:**
  1. Compute `diffStepToolLists(before, after)` and show `after` immediately (current behavior).
  2. Call the RPC.
  3. On success, apply the **server's** list per affected step with the same 3-way merge as `revertStepToolListChanges`. A step still showing the optimistic list takes the server list. A step edited since keeps those edits, applied on top of the server list.
  4. Affected steps outside the loaded scenario are ignored locally; they reload on demand.
  5. Replace library state with the returned rows.
  6. Remove the storage objects of deleted library rows best-effort, after commit (as today).
- **On error:** revert the steps exactly as now, and show "Save failed" with a mapped message:
  - `42501` → "You don't have permission to …"
  - `22023` → the validation text
  - other → the server message

  No client-side library write exists any more, so nothing dependent can run after a failure.
- **If the response is lost after the commit:** the client reverts, but the `step_tools` realtime events refresh the affected tasks to the committed state. A retry is idempotent.

## 7. Failure behavior, migration and deployment

- **Atomicity.** All-or-nothing: an RPC error rolls back step rows and library rows together. The advisory lock prevents two catalog operations on one project from interleaving.
- **The migration is additive only:** three functions plus `private.tool_segment`. There are no table, column, policy or data changes, **no backfill and no historical cleanup**. Existing orphan rows (for example "Torque Driver" left by past editor renames), mixed spellings and legacy `custom_fields.stepToolLists` stay as they are. Any cleanup would be a separate, approved proposal, starting with a read-only report of affected rows.
- **Deploy order** (per CLAUDE.md):
  1. Apply the migration.
  2. `npm run gen:types`, then commit `database.types.ts`.
  3. Deploy the client.
- **Mixed versions during rollout.** Old clients keep today's behavior, which is no worse than now. A new client against a database without the functions gets `PGRST202`. It must report "Save failed — server update pending" and **not** fall back to the old path.
- **Rollback.** Revert the client commit first, then drop the functions.

## 8. Proposed files

| File | Change |
|---|---|
| `supabase/migrations/<ts>_atomic_tool_catalog_operations.sql` | `list_project_tool_usage`, `rename_project_tools`, `delete_project_tool`, `private.tool_segment`; grants and revokes |
| `supabase/tests/tool_catalog_operations_test.sql` | pgTAP (see below) |
| `src/lib/database.types.ts` | regenerated |
| `src/domain/supabase-planner.ts` | RPC wrappers and error mapping; `saveTaskRowsToSupabase` (no tool sync) |
| `src/domain/step-tools.ts` | `applyConfirmedStepToolLists` (shares the 3-way merge with the revert) |
| `src/domain/step-tool-ids.test.ts` | id parity fixtures (mirrored in pgTAP) |
| `src/components/line-workspace/use-workspace-tools.ts` | rename, delete and tidy call the RPCs; tidy plan built from project-wide usage |
| `src/components/project-catalog-setup-panel.tsx` | delete confirmation counts become project-wide |
| `src/components/line-workspace.tsx` | Gantt reorder uses `saveTaskRowsToSupabase` |
| `src/lib/…` realtime | subscribe to `tool_library` → reload the library |
| `src/components/mobile-photo-portal.tsx` | Step 1 (§5a): task-row-only saves for rename, add and reorder; step delete without a tool sync; diff-based draft and retry tool writes (including IndexedDB replay); targeted Restore Step |
| `e2e/catalog.spec.ts` | the verification above as a committed regression |

## 9. Tests

**pgTAP:**
- rename with and without a target row
- merge on a step that holds both names
- multi-scenario scope
- other-project rows untouched
- the ids produced
- delete
- tidy over many spellings
- idempotent re-run
- `42501` for anonymous, view-only, other-workspace and editor-merge-without-delete-right
- `22023` validation
- full rollback when a mid-operation statement fails

**Vitest:**
- id parity
- the confirmed-merge helper (concurrent edits kept)
- the tools hook: RPC success applies server lists; error reverts; no shell save
- reorder makes no `step_tools` calls

**E2E (retained database, disposable fixtures):**
1. Rename, delete and tidy persist across a reload.
2. A rename followed by a Gantt reorder of the same task keeps the new name.
3. An editor merge-rename shows a permission error and changes nothing.

## 10. Expected UI impact (needs your approval)

- **Persistence (intended fix):** renames, deletes and tidies survive a reload.
- **Delete confirmation:** counts become project-wide. The text is unchanged unless you want "across N scenarios" added.
- **Editors' permissions:** workspace editors see an explicit permission error when deleting a library-backed tool or merge-renaming. Today these appear to succeed but don't persist.
- **Tidy coverage:** the button counts spellings across the whole project.
- No new controls.

## 11. Decisions

1. ~~Scope~~ **Confirmed 2026-10-03:** project-wide across scenarios.
2. ~~Permissions~~ **Confirmed:** current rules preserved, with clear refusal errors.
3. ~~Rollout~~ **Confirmed:** remove unsafe competing writers before enabling catalog operations. The order is now M1 → C1 → M2 → M3/C2 (§5b), with Restore Step as a separate fix (`docs/restore-step-design.md`) that ships in M1/C1.
5. **Open:** approve the §5b fence (database and visible changes listed there), the legacy-draft notice wording, and whether to add the optional version banner.
4. ~~Separately: approve a focused fix for the zero-zone duplicate "Unzoned" station (§1.3).~~ Done in `33b2797`.
