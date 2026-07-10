-- Signatures bind to (content_hash, review_cycle), not to content alone.
--
-- Content-only binding replays signatures across revisions: release v1.0 at hash H, open a
-- revision, edit, then revert. The document is byte-identical to H again and every v1.0
-- signature is once more "bound to the current document" — quorum satisfied before anyone
-- reviewed anything. The same flaw resurrects year-old objections.
--
-- review_cycle increments ONLY on effective -> draft (the start of a revision). Never on
-- draft -> in_review. That placement is the whole design:
--   * within a cycle, validity tracks content, so a rejected SOP resubmitted UNCHANGED keeps
--     every other seat's signature and only the objector must act;
--   * across cycles, a content revert can never replay a prior cycle's approvals.
--
-- content_hash is stored rather than recomputed client-side: sop_doc_hash is sha256 over
-- Postgres's jsonb::text rendering, which JavaScript cannot reliably reproduce.

alter table public.sops
  add column if not exists content_hash    text,
  add column if not exists review_cycle    int not null default 0,
  add column if not exists revision_reason text;

-- Maintained by its OWN trigger, not by enforce_sop_transition. Postgres fires same-timing
-- triggers in NAME ORDER, and sops_enforce_transition reads this value — the `aa_` prefix is
-- load-bearing, not decoration.
create or replace function public.sops_set_content_hash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.content_hash := public.sop_doc_hash(new.document);
  return new;
end $$;

drop trigger if exists sops_aa_set_content_hash on public.sops;
create trigger sops_aa_set_content_hash
before insert or update on public.sops
for each row execute function public.sops_set_content_hash();

update public.sops set content_hash = public.sop_doc_hash(document) where content_hash is null;

create index if not exists sops_review_cycle_idx on public.sops (id, review_cycle);
