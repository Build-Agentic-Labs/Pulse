-- Split responsible-persons rosters that the old editor collapsed into a single entry.
--
-- `sops.document->'responsiblePersons'` is an array of roles. The previous single-line editor
-- read it as `join("; ")` but wrote the whole typed string back as ONE element, so any edit
-- collapsed the roster. It was invisible while every consumer joined the array with "; " —
-- ["A; B; C"] and ["A","B","C"] render identically — and becomes visible now that the document
-- renders one entry per line.
--
-- Live state when written: 6 of 12 authored SOPs collapsed, 0 converted (extraction produces
-- correct arrays). Of those 6, five are drafts with no signatures and one is `in_review`
-- carrying a signature.
--
-- Scoped to status = 'draft' ON PURPOSE, and the scope is the safety property rather than a
-- convenience:
--   * the transition guard freezes `document` on every non-draft row, so a wider update would
--     need the guard suspended;
--   * the in_review row's content_hash is bound by a signature, and moving it would strand that
--     signature to save someone from a missing line break.
-- That row keeps its current single-line rendering and repairs itself the moment its author next
-- edits the field, because the editor's write path no longer collapses.
--
-- Only rows holding exactly one `;`-bearing entry are touched. A roster that is already split,
-- empty, or a single entry with no semicolon is left alone.

do $$
declare v_rows int;
begin
  update public.sops s
     set document = jsonb_set(
           s.document,
           '{responsiblePersons}',
           (select coalesce(jsonb_agg(trimmed), '[]'::jsonb)
              from (
                select btrim(part) as trimmed
                  from unnest(string_to_array(s.document -> 'responsiblePersons' ->> 0, ';')) as part
              ) parts
             where trimmed <> ''),
           true)
   where s.status = 'draft'
     and jsonb_typeof(s.document -> 'responsiblePersons') = 'array'
     and jsonb_array_length(s.document -> 'responsiblePersons') = 1
     and s.document -> 'responsiblePersons' ->> 0 like '%;%';

  get diagnostics v_rows = row_count;
  raise notice 'Split collapsed responsible-persons roster on % draft SOP(s)', v_rows;

  -- Post-condition: no draft is left holding a collapsed roster.
  if exists (
    select 1 from public.sops
     where status = 'draft'
       and jsonb_typeof(document -> 'responsiblePersons') = 'array'
       and jsonb_array_length(document -> 'responsiblePersons') = 1
       and document -> 'responsiblePersons' ->> 0 like '%;%'
  ) then
    raise exception 'Split incomplete: a draft still holds a collapsed responsible-persons roster';
  end if;
end $$;
