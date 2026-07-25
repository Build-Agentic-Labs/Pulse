-- Follow-up to 20260725120000: never let stamping the number change the document hash.
--
-- The release edge mirrors the minted number into document->meta->sopNumber so the frozen
-- revision is self-describing. That is hash-neutral only because sop_doc_hash strips
-- {meta,sopNumber}: strip(stamp(doc)) = strip(doc), so signatures survive the stamp.
--
-- That identity breaks for exactly one shape of document: one with NO meta object at all.
-- 20260725120000 created `meta: {}` before setting the leaf (jsonb_set's create_missing only
-- creates the leaf, so the parent had to exist). After the strip, `{"body":"x","meta":{}}` is
-- not `{"body":"x"}` -- the hash moves, and the quality_approval signature that authorized the
-- release is stranded on the old hash.
--
-- No production document is affected: all 18 rows carry a meta object, and the TypeScript Sop
-- type requires one, so the app cannot produce a document without it. This is a latent path
-- being closed, not an incident -- but "releasing a document can void its own approval
-- signature" is not a path to leave open in a controlled-document system. Caught by
-- sops_enforcement_test, whose fixture document is a bare '{"body":"v1"}'.
--
-- Fix: mirror into the jsonb only when meta already exists. sops.sop_number is authoritative
-- either way (see effectiveSopNumber), so a document without meta simply keeps the number in
-- the column alone rather than having its hash moved.
--
-- Patched in place, not rewritten -- see the note in 20260725120000 and CLAUDE.md.
do $migration$
declare v_definition text;
begin
  select pg_get_functiondef('public.enforce_sop_transition()'::regprocedure) into v_definition;

  if position($from$        new.document := jsonb_set(
          case
            when coalesce(new.document, '{}'::jsonb) ? 'meta' then new.document
            else coalesce(new.document, '{}'::jsonb) || jsonb_build_object('meta', '{}'::jsonb)
          end,
          '{meta,sopNumber}', to_jsonb(v_number), true);$from$ in v_definition) = 0 then
    raise exception 'Release-edge number stamp changed';
  end if;

  v_definition := replace(
    v_definition,
    $from$        new.document := jsonb_set(
          case
            when coalesce(new.document, '{}'::jsonb) ? 'meta' then new.document
            else coalesce(new.document, '{}'::jsonb) || jsonb_build_object('meta', '{}'::jsonb)
          end,
          '{meta,sopNumber}', to_jsonb(v_number), true);$from$,
    $to$        -- Mirror into the jsonb ONLY when a meta object already exists. Creating one
        -- would leave `meta: {}` behind once sop_doc_hash strips the number, moving the hash
        -- and stranding the signature that authorized this very release. The promoted
        -- sop_number column is authoritative regardless.
        if new.document ? 'meta' then
          new.document := jsonb_set(new.document, '{meta,sopNumber}', to_jsonb(v_number), true);
        end if;$to$
  );

  execute v_definition;
end $migration$;
