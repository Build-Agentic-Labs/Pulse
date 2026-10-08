-- Insert a step and shift following positions in the existing versioned transaction.
do $migration$
declare definition text := pg_get_functiondef('public.edit_quality_wi(uuid,integer,uuid,text,jsonb,uuid)'::regprocedure);
begin
 if (length(definition)-length(replace(definition,$old$  v_step:=(p_payload->>'id')::uuid;
  select coalesce(max(position),0)+1 into v_position from public.quality_wi_steps where wi_id=p_id and removed_at is null;
  insert into public.quality_wi_steps(id,wi_id,position,title,instruction) values(v_step,p_id,v_position,coalesce(p_payload->>'title',''),coalesce(p_payload->>'instruction',''));$old$,'')))/length($old$  v_step:=(p_payload->>'id')::uuid;
  select coalesce(max(position),0)+1 into v_position from public.quality_wi_steps where wi_id=p_id and removed_at is null;
  insert into public.quality_wi_steps(id,wi_id,position,title,instruction) values(v_step,p_id,v_position,coalesce(p_payload->>'title',''),coalesce(p_payload->>'instruction',''));$old$) <> 1 then
  raise exception 'WI insertion migration: unexpected add_step definition';
 end if;
 definition := replace(definition,$old$  v_step:=(p_payload->>'id')::uuid;
  select coalesce(max(position),0)+1 into v_position from public.quality_wi_steps where wi_id=p_id and removed_at is null;
  insert into public.quality_wi_steps(id,wi_id,position,title,instruction) values(v_step,p_id,v_position,coalesce(p_payload->>'title',''),coalesce(p_payload->>'instruction',''));$old$,$new$  if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('id','title','instruction','afterId'))
   or exists(select 1 from jsonb_each(p_payload) where jsonb_typeof(value)<>'string') then
    raise exception 'Invalid new step fields.' using errcode='22023';
  end if;
  v_step:=(p_payload->>'id')::uuid;
  if p_payload ? 'afterId' then
   select position+1 into v_position from public.quality_wi_steps
    where id=(p_payload->>'afterId')::uuid and wi_id=p_id and removed_at is null;
   if not found then raise exception 'The insertion step is no longer in the draft. Your draft has been retained.' using errcode='PT409'; end if;
   -- Descending updates avoid the immediate unique constraint on active positions.
   for v_item in select to_jsonb(id) from public.quality_wi_steps
    where wi_id=p_id and removed_at is null and position>=v_position order by position desc loop
    update public.quality_wi_steps set position=position+1 where id=(v_item#>>'{}')::uuid;
   end loop;
  else
   select coalesce(max(position),0)+1 into v_position from public.quality_wi_steps where wi_id=p_id and removed_at is null;
  end if;
  insert into public.quality_wi_steps(id,wi_id,position,title,instruction) values(v_step,p_id,v_position,coalesce(p_payload->>'title',''),coalesce(p_payload->>'instruction',''));$new$);
 execute definition;
end;
$migration$;
