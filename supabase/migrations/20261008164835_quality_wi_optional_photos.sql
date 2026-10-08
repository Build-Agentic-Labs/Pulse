-- Existing steps keep their photo layout; hiding retains the stored image.
alter table public.quality_wi_steps add column show_photo boolean not null default true;

do $migration$
declare definition text := pg_get_functiondef('public.edit_quality_wi(uuid,integer,uuid,text,jsonb,uuid)'::regprocedure);
begin
 if (length(definition)-length(replace(definition,$old$k not in ('id','title','instruction'))$old$,'')))/length($old$k not in ('id','title','instruction'))$old$) <> 1 then
  raise exception 'Optional WI photo migration: unexpected function definition';
 end if;
 definition := replace(definition,$old$k not in ('id','title','instruction'))$old$,$new$k not in ('id','title','instruction','showPhoto'))$new$);
 if (length(definition)-length(replace(definition,$old$or exists(select 1 from jsonb_each(p_payload) where jsonb_typeof(value)<>'string') then raise exception 'Invalid step fields.'$old$,'')))/length($old$or exists(select 1 from jsonb_each(p_payload) where jsonb_typeof(value)<>'string') then raise exception 'Invalid step fields.'$old$) <> 1 then
  raise exception 'Optional WI photo migration: unexpected function definition';
 end if;
 definition := replace(definition,$old$or exists(select 1 from jsonb_each(p_payload) where jsonb_typeof(value)<>'string') then raise exception 'Invalid step fields.'$old$,$new$or exists(select 1 from jsonb_each(p_payload) where (key='showPhoto' and jsonb_typeof(value)<>'boolean') or (key<>'showPhoto' and jsonb_typeof(value)<>'string')) then raise exception 'Invalid step fields.'$new$);
 if (length(definition)-length(replace(definition,$old$instruction=coalesce(p_payload->>'instruction',instruction) where id=v_step;$old$,'')))/length($old$instruction=coalesce(p_payload->>'instruction',instruction) where id=v_step;$old$) <> 1 then
  raise exception 'Optional WI photo migration: unexpected function definition';
 end if;
 definition := replace(definition,$old$instruction=coalesce(p_payload->>'instruction',instruction) where id=v_step;$old$,$new$instruction=coalesce(p_payload->>'instruction',instruction),show_photo=coalesce((p_payload->>'showPhoto')::boolean,show_photo) where id=v_step;$new$);
 execute definition;
end;
$migration$;

do $migration$
declare definition text := pg_get_functiondef('public.publish_quality_wi(uuid,integer,uuid,text,uuid)'::regprocedure);
begin
 if (length(definition)-length(replace(definition,$old$s.removed_at is null and s.image is not null and not exists$old$,'')))/length($old$s.removed_at is null and s.image is not null and not exists$old$) <> 1 then
  raise exception 'Optional WI photo migration: unexpected function definition';
 end if;
 definition := replace(definition,$old$s.removed_at is null and s.image is not null and not exists$old$,$new$s.removed_at is null and s.show_photo and s.image is not null and not exists$new$);
 if (length(definition)-length(replace(definition,$old$jsonb_build_object('id',id,'title',title,'instruction',instruction,'image',image)$old$,'')))/length($old$jsonb_build_object('id',id,'title',title,'instruction',instruction,'image',image)$old$) <> 1 then
  raise exception 'Optional WI photo migration: unexpected function definition';
 end if;
 definition := replace(definition,$old$jsonb_build_object('id',id,'title',title,'instruction',instruction,'image',image)$old$,$new$jsonb_build_object('id',id,'title',title,'instruction',instruction,'showPhoto',show_photo,'image',image)$new$);
 execute definition;
end;
$migration$;
