-- listHistoricalRevisions (src/lib/sop/review.ts) filters sop_revisions by workspace_id and
-- orders by created_at desc, but the only index on the snapshot table is (sop_id, created_at
-- desc) — no leading workspace_id column — so that read falls back to a sequential scan of the
-- whole revision history. Add the covering (workspace_id, created_at desc) index so the filter
-- and sort are served from the index.
create index if not exists sop_revisions_workspace_created_idx
  on public.sop_revisions (workspace_id, created_at desc);
