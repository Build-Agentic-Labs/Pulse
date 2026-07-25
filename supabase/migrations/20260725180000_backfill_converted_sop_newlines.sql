-- Backfill: repair double-escaped newlines left in converted SOPs.
--
-- Three converted SOPs carry the two characters `\` `n` where a paragraph break belongs, all in
-- `purpose` and `scope` (19 occurrences). The model emitted a literal instead of an escape the
-- JSON decoder consumes; the extraction boundary now normalizes this going forward
-- (unescapeLiteralNewlines in src/domain/sop/extraction-validate.ts), but rows converted before
-- that fix still hold the literal. No authored SOP was ever affected.
--
-- Same context-bound rule as the application fix, deliberately: a literal `\n` is ambiguous once
-- emitted -- `C:\network\share` contains one -- so this only fires where a backslash sequence
-- CANNOT be a path: a paragraph pair, or a break followed by whitespace or a bullet. No path
-- segment begins with a space, hyphen, or another backslash. A lone mid-word `\n` is left alone.
--
-- Safe to run against live data: every affected row is a draft, never released, with zero
-- signatures, so no snapshot or e-signature binds the text being corrected. The rows ARE
-- re-hashed by sops_aa_set_content_hash, which is exactly right -- the content genuinely changes.
-- The transition guard's content freeze only applies to non-draft rows, so it needs no
-- suspension here.
--
-- In a SQL literal with standard_conforming_strings on, '\\n' is backslash-backslash-n, which the
-- regex engine reads as "one literal backslash, then n" -- the sequence being repaired.

create or replace function pg_temp.unescape_literal_newlines(v text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(v, '(\\r)?\\n(\\r)?\\n', chr(10) || chr(10), 'g'),
             -- `-` sits last in the bracket expression so it is a literal, not a range.
             '(\\r)?\\n(?=[[:space:]*•-])', chr(10), 'g'),
           '(\\r)?\\n$', chr(10));
$$;

do $$
declare
  v_rows int;
  v_left int;
begin
  update public.sops s
     set document = jsonb_set(
           jsonb_set(
             s.document,
             '{purpose}',
             to_jsonb(pg_temp.unescape_literal_newlines(coalesce(s.document ->> 'purpose', ''))),
             true),
           '{scope}',
           to_jsonb(pg_temp.unescape_literal_newlines(coalesce(s.document ->> 'scope', ''))),
           true)
   where jsonb_typeof(s.document -> 'purpose') = 'string'
     and jsonb_typeof(s.document -> 'scope') = 'string'
     and (coalesce(s.document ->> 'purpose', '') ~ '\\n'
       or coalesce(s.document ->> 'scope', '') ~ '\\n');

  get diagnostics v_rows = row_count;
  raise notice 'Repaired escaped newlines in % SOP(s)', v_rows;

  -- Post-condition: the two fields this touched must be clean.
  if exists (
    select 1 from public.sops
     where coalesce(document ->> 'purpose', '') ~ '\\n'
        or coalesce(document ->> 'scope', '') ~ '\\n'
  ) then
    raise exception 'Backfill incomplete: a literal escaped newline remains in purpose/scope';
  end if;

  -- Anywhere else is reported, not repaired: outside these prose fields a backslash-n is far
  -- more likely to be content (a path, a tolerance) than a mangled break.
  select count(*) into v_left
    from public.sops
   where position(chr(92) || chr(92) || 'n' in document::text) > 0;
  if v_left > 0 then
    raise notice 'Note: % SOP(s) still contain a literal backslash-n outside purpose/scope; left as content', v_left;
  end if;
end $$;
