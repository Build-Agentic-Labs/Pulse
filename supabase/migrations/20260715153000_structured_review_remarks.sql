-- Replace free-position PDF pins with section-organized review remarks.
-- Existing annotations are preserved under the Overall category.

alter table public.sop_review_annotations
  add column if not exists category text;

update public.sop_review_annotations
set category = 'overall'
where category is null or btrim(category) = '';

alter table public.sop_review_annotations
  alter column category set default 'overall',
  alter column category set not null,
  alter column page_number drop not null,
  alter column x_percent drop not null,
  alter column y_percent drop not null;

create index if not exists sop_review_annotations_category_idx
  on public.sop_review_annotations(sop_id, review_cycle, category, created_by);
