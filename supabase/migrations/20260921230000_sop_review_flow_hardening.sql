-- Keep the single draft-review round used by the editor and queue. Resolved feedback
-- does not require a second submission; formal signatures still pin exact content.
-- Recheck active reviewer membership and serialize reviews against recalls/reassignment.
-- RLS: only the active assigned department member may return a review; only an
-- authorized author/submitter can request signatures; reassignment stays admin-only.

do $migration$
declare v_definition text; v_anchor text;
begin
  select pg_get_functiondef('public.request_sop_final_approval(text)'::regprocedure) into v_definition;
  v_definition := replace(v_definition, E'\r\n', E'\n');
  v_anchor := $anchor$            and submission.content_hash = s.content_hash
            and submission.no_changes = true
$anchor$;
  v_anchor := replace(v_anchor, E'\r\n', E'\n');
  if (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'SOP flow patch anchor missing or ambiguous in request_sop_final_approval(text)';
  end if;
  v_definition := replace(v_definition, v_anchor, $replacement$$replacement$);
  v_anchor := $anchor$Every required departmental approver must return No changes needed before final approval$anchor$;
  v_anchor := replace(v_anchor, E'\r\n', E'\n');
  if (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'SOP flow patch anchor missing or ambiguous in request_sop_final_approval(text)';
  end if;
  v_definition := replace(v_definition, v_anchor, $replacement$Every required departmental approver must respond before final approval$replacement$);
  v_anchor := $anchor$  if s.content_hash is null or s.content_hash = '' then$anchor$;
  v_anchor := replace(v_anchor, E'\r\n', E'\n');
  if (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'SOP flow patch anchor missing or ambiguous in request_sop_final_approval(text)';
  end if;
  v_definition := replace(v_definition, v_anchor, $replacement$  if not public.can_read_sop(p_sop) then
    raise exception 'You no longer have access to this SOP';
  end if;
  if s.content_hash is null or s.content_hash = '' then$replacement$);
  execute v_definition;
end;
$migration$;

do $migration$
declare v_definition text; v_anchor text;
begin
  select pg_get_functiondef('public.submit_sop_review(text,boolean)'::regprocedure) into v_definition;
  v_definition := replace(v_definition, E'\r\n', E'\n');
  v_anchor := $anchor$  where id = p_sop and deleted_at is null;$anchor$;
  v_anchor := replace(v_anchor, E'\r\n', E'\n');
  if (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'SOP flow patch anchor missing or ambiguous in submit_sop_review(text,boolean)';
  end if;
  v_definition := replace(v_definition, v_anchor, $replacement$  where id = p_sop and deleted_at is null for update;$replacement$);
  v_anchor := $anchor$  if not exists (
    select 1 from public.sop_review_seats seat$anchor$;
  v_anchor := replace(v_anchor, E'\r\n', E'\n');
  if (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'SOP flow patch anchor missing or ambiguous in submit_sop_review(text,boolean)';
  end if;
  v_definition := replace(v_definition, v_anchor, $replacement$  if not public.holds_sop_seat(p_sop) then
    raise exception 'Only an active assigned reviewer can submit this review';
  end if;
  if p_no_changes is null then
    raise exception 'Choose whether this review needs changes';
  end if;
  if not exists (
    select 1 from public.sop_review_seats seat$replacement$);
  v_anchor := $anchor$      and seat.signer_id = auth.uid()$anchor$;
  v_anchor := replace(v_anchor, E'\r\n', E'\n');
  if (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'SOP flow patch anchor missing or ambiguous in submit_sop_review(text,boolean)';
  end if;
  v_definition := replace(v_definition, v_anchor, $replacement$      and seat.signer_id = auth.uid()
      and public.is_department_member(seat.department_id, auth.uid())$replacement$);
  execute v_definition;
end;
$migration$;

do $migration$
declare v_definition text; v_anchor text;
begin
  select pg_get_functiondef('public.reassign_sop_seat(text,text,uuid)'::regprocedure) into v_definition;
  v_definition := replace(v_definition, E'\r\n', E'\n');
  v_anchor := $anchor$  -- A seat that has signed is closed.$anchor$;
  v_anchor := replace(v_anchor, E'\r\n', E'\n');
  if (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'SOP flow patch anchor missing or ambiguous in reassign_sop_seat(text,text,uuid)';
  end if;
  v_definition := replace(v_definition, v_anchor, $replacement$  if s.status = 'in_review' and p_new_signer is not distinct from s.submitted_by then
    raise exception 'The submitter cannot be assigned an approval seat';
  end if;

  -- A seat that has signed is closed.$replacement$);
  v_anchor := $anchor$  v_old := st.signer_id;$anchor$;
  v_anchor := replace(v_anchor, E'\r\n', E'\n');
  if (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'SOP flow patch anchor missing or ambiguous in reassign_sop_seat(text,text,uuid)';
  end if;
  v_definition := replace(v_definition, v_anchor, $replacement$  if st.signer_id is not distinct from p_new_signer then return; end if;
  -- A replacement must complete draft review before the signature phase resumes.
  if s.status = 'in_review' and s.final_approval_requested_at is not null
     and not exists (select 1 from public.sop_review_submissions r
       where r.sop_id = p_sop and r.review_cycle = s.review_cycle and r.reviewer_id = p_new_signer) then
    update public.sops set final_approval_requested_at = null,
      final_approval_content_hash = null, final_approval_requested_by = null where id = p_sop;
  end if;
  v_old := st.signer_id;$replacement$);
  execute v_definition;
end;
$migration$;
-- The public sops UPDATE policy also admits workflow writes. Enforce the final
-- approval gate on the columns themselves, not only inside the request RPC.
create or replace function public.enforce_sop_final_approval_fields()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.final_approval_requested_at is not distinct from old.final_approval_requested_at
     and new.final_approval_content_hash is not distinct from old.final_approval_content_hash
     and new.final_approval_requested_by is not distinct from old.final_approval_requested_by then
    return new;
  end if;

  if new.final_approval_requested_at is null then
    if old.final_approval_requested_at is not null
       and auth.uid() is distinct from old.created_by
       and auth.uid() is distinct from old.submitted_by
       and not public.has_workspace_role(old.workspace_id, array['owner','admin']::public.workspace_role[]) then
      raise exception 'Only the author, submitter or an admin can reset final approval';
    end if;
    new.final_approval_content_hash := null;
    new.final_approval_requested_by := null;
    return new;
  end if;

  if old.status <> 'in_review' or new.status <> 'in_review' then
    raise exception 'Final approval can only begin after draft review';
  end if;
  if (auth.uid() is distinct from old.created_by and auth.uid() is distinct from old.submitted_by)
     or not public.can_read_sop(old.id) then
    raise exception 'Only the SOP author or submitter can request final approval';
  end if;
  if old.content_hash is null or old.content_hash = '' then
    raise exception 'Save the SOP before requesting final approval';
  end if;
  if not exists (select 1 from public.sop_review_seats st where st.sop_id=old.id and st.rasic='responsible') then
    raise exception 'Assign at least one required departmental approver before requesting final approval';
  end if;
  if exists (
    select 1 from public.sop_review_seats st where st.sop_id=old.id and st.rasic='responsible'
    and (st.signer_id is null or not exists (
      select 1 from public.sop_review_submissions r
      where r.sop_id=old.id and r.review_cycle=old.review_cycle and r.reviewer_id=st.signer_id
    ))
  ) then
    raise exception 'Every required departmental approver must respond before final approval';
  end if;
  if exists (select 1 from public.sop_review_annotations a
    where a.sop_id=old.id and a.review_cycle=old.review_cycle and a.resolved_at is null) then
    raise exception 'Address every returned remark before requesting final approval';
  end if;
  new.final_approval_requested_at := now();
  new.final_approval_content_hash := old.content_hash;
  new.final_approval_requested_by := auth.uid();
  return new;
end;
$$;
revoke all on function public.enforce_sop_final_approval_fields() from public, anon, authenticated;
create trigger enforce_sop_final_approval_fields
before update of final_approval_requested_at, final_approval_content_hash, final_approval_requested_by on public.sops
for each row execute function public.enforce_sop_final_approval_fields();

-- Record exactly one request event regardless of whether the authorized change
-- arrived through the RPC or a direct update. This preserves notification routing.
create or replace function public.log_sop_final_approval_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.final_approval_requested_at is not null
     and (new.final_approval_requested_at is distinct from old.final_approval_requested_at
       or new.final_approval_content_hash is distinct from old.final_approval_content_hash) then
    perform public.append_sop_event(new.id, 'final_approval_requested',
      jsonb_build_object('content_hash',new.final_approval_content_hash));
  end if;
  return new;
end;
$$;
revoke all on function public.log_sop_final_approval_request() from public, anon, authenticated;
create trigger log_sop_final_approval_request
 after update of final_approval_requested_at, final_approval_content_hash, final_approval_requested_by on public.sops
 for each row execute function public.log_sop_final_approval_request();

do $migration$
declare v_definition text; v_anchor text;
begin
  select pg_get_functiondef('public.request_sop_final_approval(text)'::regprocedure) into v_definition;
  v_definition := replace(v_definition, E'\r\n', E'\n');
  v_anchor := $anchor$  perform public.append_sop_event(
    p_sop,
    'final_approval_requested',
    jsonb_build_object('content_hash', s.content_hash)
  );$anchor$;
  v_anchor := replace(v_anchor, E'\r\n', E'\n');
  if (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'Final approval event anchor missing or ambiguous';
  end if;
  execute replace(v_definition, v_anchor, '  -- The AFTER UPDATE trigger records the request event.');
end;
$migration$;
