-- Close the review-annotation forgery hole.
--
-- The sop_review_annotations UPDATE policy (20260715150000) grants row access to
-- BOTH the remark's creator and the SOP author. RLS is row-level, not
-- column-level, so the author branch let the SOP author rewrite ANY column of a
-- reviewer's annotation via raw PostgREST -- including body, author_name, and
-- created_by -- forging a reviewer's remark and its identity.
--
-- The legitimate flows are narrow and column-specific:
--   * the creator edits their own remark's `body` (saveSopReviewRemark);
--   * the SOP author toggles `resolved_at`/`resolved_by`, which goes through the
--     resolve_sop_review_annotation SECURITY DEFINER RPC (author-checked, RLS
--     bypassing) -- so it does not depend on the RLS author branch at all.
-- Everything else (provenance and page position) is fixed at insert time.
--
-- Enforce those column-level rules with a BEFORE UPDATE trigger, mirroring the
-- existing stamp_sop_review_annotation BEFORE INSERT trigger. The row-level
-- UPDATE policy is left intact; the trigger constrains WHICH columns each actor
-- may change, for every update path (creator PostgREST, resolution RPC, and any
-- author PostgREST update the policy still permits).

create or replace function public.guard_sop_review_annotation_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare sop_author uuid;
begin
  -- Provenance and page position are fixed at insert time and never change on
  -- update, no matter who performs it. Blocks rewriting a remark's identity.
  if new.created_by is distinct from old.created_by
     or new.author_name is distinct from old.author_name
     or new.sop_id is distinct from old.sop_id
     or new.review_cycle is distinct from old.review_cycle
     or new.category is distinct from old.category
     or new.created_at is distinct from old.created_at
     or new.page_number is distinct from old.page_number
     or new.x_percent is distinct from old.x_percent
     or new.y_percent is distinct from old.y_percent then
    raise exception 'A review remark''s author, category, position, and creation metadata are immutable';
  end if;

  -- Only the reviewer who wrote a remark may edit its text.
  if new.body is distinct from old.body and auth.uid() is distinct from old.created_by then
    raise exception 'Only the reviewer who wrote a remark may edit its text';
  end if;

  -- Only the SOP author may change resolution state (also gated by
  -- resolve_sop_review_annotation, under which auth.uid() is the author).
  if new.resolved_at is distinct from old.resolved_at
     or new.resolved_by is distinct from old.resolved_by then
    select created_by into sop_author from public.sops where id = old.sop_id;
    if auth.uid() is distinct from sop_author then
      raise exception 'Only the SOP author may change a remark''s resolution state';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_sop_review_annotation_update on public.sop_review_annotations;
create trigger guard_sop_review_annotation_update
before update on public.sop_review_annotations
for each row execute function public.guard_sop_review_annotation_update();

revoke execute on function public.guard_sop_review_annotation_update() from public, anon, authenticated;
