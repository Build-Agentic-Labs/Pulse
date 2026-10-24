# PFMEA cell-save pilot

Phase-one cell saves and PFMEA document commands. The migrations were applied to the linked database; installation does not rewrite existing records.

## Run the isolated database checks

Use a disposable Postgres 17 database at `127.0.0.1:58522`, database `pfmea_cell_test`, user `postgres`, password `pfmea-local-fixture`. The scripts deliberately use this fixed loopback connection; they do not read application environment credentials.

Apply `bootstrap.sql`, then `supabase/migrations/20261024020000_pfmea_cell_save_contract.sql` to that disposable database. Run:

```
node tests/pfmea-cells/integration.mjs
node tests/pfmea-cells/commands.mjs
node tests/pfmea-cells/browser/server.mjs
```

Open `http://127.0.0.1:3005/?editor=alice` and `http://127.0.0.1:3005/?editor=bob`. These use separate synthetic actor identities and the actual PFMEA grid/save queue/cell adapter against the local SQL function. This checks RLS actor behavior, not production Auth login flows. Each grid contains 242 synthetic Procedure-linked rows. No actual Procedure or SOP records are accessed.

Browser checks performed:

- Different fields on the same row saved from both editors and appeared together after reload.
- A stale same-cell edit was blocked; its local draft remained visible and editing paused.
- Losing a response after the database committed, then reloading, recovered the exact mutation ID and acknowledged it without a false conflict.
- Normal successful saves displayed no saving/saved notification.

The SQL integration script truncates only the disposable database fixtures. Stop the browser fixture before rerunning it.

## Rollout boundary

Cell saving is enabled by default in LineWorkspace after applying both migrations. `NEXT_PUBLIC_PFMEA_CELL_SAVES=false` is a compatibility switch for unmigrated environments, not a way to write snapshots to cell-managed documents.

Ordinary fields use cell patches. Settings, metadata, creation/import/sync, and effectiveness confirmation use a separate document command with compare-and-swap protection. Completion is validated by Postgres, including required evidence and a final RPN strictly below the configured threshold. Command retries retain their mutation identity. Both paths update only the PFMEA JSON fragment and preserve unrelated product fields.

The existing real-time workspace subscription still refreshes product data; a dedicated live cell reconciliation layer and same-cell conflict resolution UI remain subsequent work. This is safe cell-based persistence, not character-by-character shared text editing.
