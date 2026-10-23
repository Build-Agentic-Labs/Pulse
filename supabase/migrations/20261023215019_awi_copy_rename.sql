-- Independent draft copy. Existing masters, releases and product links are never updated.
create function public.copy_awi_master(p_source uuid,p_title text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare src public.awi_masters%rowtype; dest public.awi_masters%rowtype;
 new_master uuid; source_task public.tasks%rowtype; step_map jsonb := '{}'; fields_text text; r record; new_step text;
begin
 select * into strict src from public.awi_masters where id=p_source;
 if auth.uid() is null or not public.has_product_project_access(src.project_id,'edit') then
  raise exception 'You do not have permission to copy this AWI.' using errcode='42501';
 end if;
 select * into strict source_task from public.tasks where id=src.task_id for update;
 new_master := public.create_awi_master(src.workspace_id,p_title,'');
 select * into strict dest from public.awi_masters where id=new_master;
 perform public.update_awi_metadata(dest.id,dest.document_number,src.category,dest.document_number,dest.category);
 delete from public.manufacturing_steps where task_id=dest.task_id;
 for r in select id from public.manufacturing_steps where task_id=src.task_id order by id for update loop
  step_map := step_map || jsonb_build_object(r.id,gen_random_uuid()::text);
 end loop;
 insert into public.manufacturing_steps(id,task_id,sequence,name,instruction,duration_minutes,quality_check,dependency_ids)
 select step_map->>s.id,dest.task_id,s.sequence,s.name,s.instruction,s.duration_minutes,s.quality_check,
 array(select step_map->>d from unnest(s.dependency_ids) d where step_map ? d)
 from public.manufacturing_steps s where s.task_id=src.task_id;
 insert into public.part_references(id,task_id,part_number,description,quantity,disposition)
 select gen_random_uuid()::text,dest.task_id,part_number,description,quantity,disposition from public.part_references where task_id=src.task_id;
 insert into public.step_tools(id,task_id,step_id,sequence,tool_name)
 select gen_random_uuid()::text,dest.task_id,step_map->>step_id,sequence,tool_name from public.step_tools where task_id=src.task_id;
 fields_text := (source_task.custom_fields - array['stepPhotoAttachments','taskExplodedViews','taskVideos','stepToolLists','awiMasterLink','awiMasterId','awiReleaseId'])::text;
 for r in select key,value from jsonb_each_text(step_map) loop
  fields_text := replace(fields_text,to_jsonb(r.key)::text,to_jsonb(r.value)::text);
 end loop;
 update public.tasks set description=source_task.description,safety_notes=source_task.safety_notes,
 planned_duration_minutes=source_task.planned_duration_minutes,tools_required=source_task.tools_required,
 equipment_required=source_task.equipment_required,qc_checklist=source_task.qc_checklist,notes=source_task.notes,
 drawing_link=source_task.drawing_link,
 custom_fields=fields_text::jsonb || jsonb_build_object('awiDocumentNumber',dest.document_number)
 where id=dest.task_id;
 return dest.id;
end $$;
revoke all on function public.copy_awi_master(uuid,text) from public,anon;
grant execute on function public.copy_awi_master(uuid,text) to authenticated;

create function public.rename_awi_master(p_master uuid,p_title text,p_expected_title text)
returns void language plpgsql security invoker set search_path='' as $$
declare m public.awi_masters%rowtype;
begin
 select * into strict m from public.awi_masters where id=p_master;
 if auth.uid() is null or not public.has_product_project_access(m.project_id,'edit') then
  raise exception 'You do not have permission to rename this AWI.' using errcode='42501';
 end if;
 if length(btrim(p_title)) not between 1 and 200 then raise exception 'Enter a title (up to 200 characters).'; end if;
 update public.tasks set name=btrim(p_title) where id=m.task_id and name=p_expected_title;
 if not found then raise exception 'The AWI name changed. Reload before renaming.' using errcode='40001'; end if;
 update public.projects set name=btrim(p_title) where id=m.project_id;
end $$;
revoke all on function public.rename_awi_master(uuid,text,text) from public,anon;
grant execute on function public.rename_awi_master(uuid,text,text) to authenticated;
