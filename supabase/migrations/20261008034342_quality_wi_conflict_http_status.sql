-- Application conflicts must not trigger PostgREST serialization retries.
do $$
declare
  signature text;
  definition text;
  expected_count integer;
begin
  foreach signature in array array[
    'public.edit_quality_wi(uuid,integer,uuid,text,jsonb,uuid)',
    'public.publish_quality_wi(uuid,integer,uuid,text,uuid)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    expected_count := case when signature like 'public.edit_%' then 3 else 1 end;
    if (length(definition)-length(replace(definition, 'errcode=''40001''', '')))/length('errcode=''40001''') <> expected_count then
      raise exception 'Unexpected WI conflict definition for %', signature;
    end if;
    execute replace(definition, 'errcode=''40001''', 'errcode=''PT409''');
  end loop;
end;
$$;
