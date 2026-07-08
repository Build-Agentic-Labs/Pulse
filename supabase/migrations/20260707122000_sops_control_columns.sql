-- Promoted document-control columns on sops (stripped from the jsonb document in the app,
-- like status). effective_revision_id is added in the Phase 3 migration alongside sop_revisions
-- (so its FK target exists). Then widen the status lifecycle to include 'effective'.
alter table public.sops
  add column if not exists doc_type text not null default 'SOP',
  add column if not exists seq_int int,
  add column if not exists major_version smallint,
  add column if not exists minor_version smallint,
  add column if not exists submitted_by uuid references auth.users(id),
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists effective_date date,
  add column if not exists next_review_date date,
  add column if not exists review_interval_months smallint not null default 24,
  add column if not exists rejected_reason text,
  add column if not exists rejected_by uuid references auth.users(id),
  add column if not exists change_significance text,
  add column if not exists requires_retraining boolean not null default false;

-- One state machine on sops.status. 'superseded' is NOT a status — the in-force copy is
-- named by sops.effective_revision_id (Phase 3); a prior effective revision is simply no
-- longer pointed to.
alter table public.sops drop constraint if exists sops_status_check;
alter table public.sops add constraint sops_status_check
  check (status in ('draft', 'in_review', 'approved', 'effective', 'obsolete'));

create index if not exists sops_next_review_idx on public.sops (next_review_date)
  where next_review_date is not null;
