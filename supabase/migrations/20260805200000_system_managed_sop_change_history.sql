-- System-managed SOP change history and explicit amendment/revision numbering.
--
-- Contract:
--   * every new controlled document starts with one immutable V1 / Initial release row;
--   * only the recorded SOP author may reopen an effective document;
--   * an amendment advances V1 -> V1.1 (MINOR);
--   * a revision advances V1 -> V2 (MAJOR, stored as 2.0 in control columns);
--   * clients can never insert, edit, or delete change-history rows directly.
--
-- enforce_sop_transition has accumulated guarded in-place patches. Keep that pattern here so a
-- drifted live function fails loudly instead of silently restoring an older lifecycle body.

do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.enforce_sop_transition()'::regprocedure) into v_definition;

  -- Locals used to preserve the caller's requested change type before trigger-managed columns
  -- are pinned, and to snapshot the author's directory identity into the immutable history row.
  if position($from$  v_objection record;
  v_number text;$from$ in v_definition) = 0 then
    raise exception 'Transition guard declaration block changed';
  end if;
  v_definition := replace(
    v_definition,
    $from$  v_objection record;
  v_number text;$from$,
    $to$  v_objection record;
  v_number text;
  v_change_significance text;
  v_actor_name text;
  v_actor_position text;
  v_history jsonb;$to$
  );

  -- New documents always receive one canonical initial-release row. Imported or hand-written
  -- history in the request is discarded: this audit area begins when Pulse takes control.
  if position($from$    new.requires_retraining := false;
    new.sop_number := null;
    return new;$from$ in v_definition) = 0 then
    raise exception 'Transition guard INSERT branch changed';
  end if;
  v_definition := replace(
    v_definition,
    $from$    new.requires_retraining := false;
    new.sop_number := null;
    return new;$from$,
    $to$    new.requires_retraining := false;
    new.sop_number := null;

    select coalesce(nullif(btrim(p.full_name), ''), 'SOP author')
      into v_actor_name
      from public.profiles p
     where p.id = coalesce(new.created_by, auth.uid());
    select coalesce(nullif(btrim(m.position_title), ''), 'Department Author')
      into v_actor_position
      from public.department_members m
     where m.department_id = new.department_id
       and m.user_id = coalesce(new.created_by, auth.uid());

    new.document := jsonb_set(
      coalesce(new.document, '{}'::jsonb),
      '{changeHistory}',
      jsonb_build_array(jsonb_build_object(
        'version', 'V1',
        'changes', 'Initial release',
        'createdByName', coalesce(v_actor_name, 'SOP author'),
        'createdByPosition', coalesce(v_actor_position, 'Department Author'),
        'createdByDate', current_date::text
      )),
      true
    );
    new.content_hash := public.sop_doc_hash(new.document);
    return new;$to$
  );

  -- Capture the requested kind before the regular trigger-owned-column pinning happens.
  if position($from$  v_revision_reason := new.revision_reason;$from$ in v_definition) = 0 then
    raise exception 'Transition guard revision capture changed';
  end if;
  v_definition := replace(
    v_definition,
    $from$  v_revision_reason := new.revision_reason;$from$,
    $to$  v_revision_reason := new.revision_reason;
  v_change_significance := new.change_significance;$to$
  );

  -- History, change kind, and retraining are lifecycle-owned. Preserve the stored history on
  -- every ordinary draft save so even a direct REST update cannot rewrite the audit trail.
  if position($from$  -- Minted by the release edge and by nothing else, on any status.
  new.sop_number := old.sop_number;$from$ in v_definition) = 0 then
    raise exception 'Transition guard lifecycle pinning block changed';
  end if;
  v_definition := replace(
    v_definition,
    $from$  -- Minted by the release edge and by nothing else, on any status.
  new.sop_number := old.sop_number;$from$,
    $to$  -- Minted by the release edge and by nothing else, on any status.
  new.sop_number := old.sop_number;
  new.change_significance := old.change_significance;
  new.requires_retraining := old.requires_retraining;
  v_history := case
    when jsonb_typeof(old.document->'changeHistory') = 'array' then old.document->'changeHistory'
    else '[]'::jsonb
  end;
  new.document := jsonb_set(coalesce(new.document, '{}'::jsonb), '{changeHistory}', v_history, true);
  new.content_hash := public.sop_doc_hash(new.document);$to$
  );

  -- Reopening is deliberately narrower than general department editing: the creator recorded in
  -- created_by must still be an active member of the owning department. Managers do not bypass
  -- authorship for this action.
  if position($from$      if not (is_manager or public.has_department_role(
                old.department_id, array['author', 'reviewer', 'approver']::public.department_sop_role[])) then
        raise exception 'Only a member of the owning department can start a revision';
      end if;$from$ in v_definition) = 0 then
    raise exception 'Transition guard effective-to-draft authorization changed';
  end if;
  v_definition := replace(
    v_definition,
    $from$      if not (is_manager or public.has_department_role(
                old.department_id, array['author', 'reviewer', 'approver']::public.department_sop_role[])) then
        raise exception 'Only a member of the owning department can start a revision';
      end if;$from$,
    $to$      if auth.uid() is distinct from old.created_by then
        raise exception 'Only the SOP author can start an amendment or revision';
      end if;
      if not public.is_department_member(old.department_id) then
        raise exception 'The SOP author must be an active member of the owning department';
      end if;$to$
  );

  if position($from$      if v_revision_reason is null or btrim(v_revision_reason) = '' then
        raise exception 'A revision needs a reason: what is changing, and why';
      end if;
      new.revision_reason := v_revision_reason;
      new.review_cycle := old.review_cycle + 1;
      new.minor_version := coalesce(old.minor_version, 0) + 1;
      new.version := coalesce(old.major_version, 1)::text || '.' || new.minor_version::text;
      new.submitted_by := null;$from$ in v_definition) = 0 then
    raise exception 'Transition guard effective-to-draft version block changed';
  end if;
  v_definition := replace(
    v_definition,
    $from$      if v_revision_reason is null or btrim(v_revision_reason) = '' then
        raise exception 'A revision needs a reason: what is changing, and why';
      end if;
      new.revision_reason := v_revision_reason;
      new.review_cycle := old.review_cycle + 1;
      new.minor_version := coalesce(old.minor_version, 0) + 1;
      new.version := coalesce(old.major_version, 1)::text || '.' || new.minor_version::text;
      new.submitted_by := null;$from$,
    $to$      if v_revision_reason is null or btrim(v_revision_reason) = '' then
        raise exception 'An amendment or revision needs a reason: what is changing, and why';
      end if;
      if v_change_significance is null or v_change_significance not in ('MINOR', 'MAJOR') then
        raise exception 'Choose amendment (MINOR) or revision (MAJOR)';
      end if;

      new.revision_reason := btrim(v_revision_reason);
      new.review_cycle := old.review_cycle + 1;
      new.change_significance := v_change_significance;
      new.requires_retraining := v_change_significance = 'MAJOR';

      if v_change_significance = 'MAJOR' then
        new.major_version := coalesce(old.major_version, 1) + 1;
        new.minor_version := 0;
      else
        new.major_version := coalesce(old.major_version, 1);
        new.minor_version := coalesce(old.minor_version, 0) + 1;
      end if;
      new.version := new.major_version::text || '.' || new.minor_version::text;

      select coalesce(nullif(btrim(p.full_name), ''), 'SOP author')
        into v_actor_name
        from public.profiles p
       where p.id = auth.uid();
      select coalesce(nullif(btrim(m.position_title), ''), 'Department Author')
        into v_actor_position
        from public.department_members m
       where m.department_id = old.department_id
         and m.user_id = auth.uid();

      new.document := jsonb_set(
        new.document,
        '{changeHistory}',
        v_history || jsonb_build_array(jsonb_build_object(
          'version', case
            when new.minor_version = 0 then 'V' || new.major_version::text
            else 'V' || new.major_version::text || '.' || new.minor_version::text
          end,
          'changes', btrim(v_revision_reason),
          'createdByName', coalesce(v_actor_name, 'SOP author'),
          'createdByPosition', coalesce(v_actor_position, 'Department Author'),
          'createdByDate', current_date::text
        )),
        true
      );
      new.content_hash := public.sop_doc_hash(new.document);
      new.submitted_by := null;$to$
  );

  execute v_definition;
end $migration$;

comment on column public.sops.change_significance is
  'System-controlled change kind for the current SOP cycle: MINOR = amendment, MAJOR = revision.';
