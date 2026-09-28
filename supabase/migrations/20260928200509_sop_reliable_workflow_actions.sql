-- Keep author handoff and the signature request in one transaction. Existing
-- transition triggers and request_sop_final_approval enforce the workflow gates.
create or replace function public.send_sop_for_signatures(p_sop text, p_expected_hash text, p_expected_cycle integer)
returns void language plpgsql security invoker set search_path = '' as $$
declare s public.sops;
begin
 select * into s from public.sops where id=p_sop and deleted_at is null for update;
 if s.id is null then raise exception 'SOP not found'; end if;
 if auth.uid() is null or auth.uid() is distinct from s.created_by then raise exception 'Only the author can send for signatures'; end if;
 if p_expected_hash is null or p_expected_cycle is null or s.content_hash is distinct from p_expected_hash or s.review_cycle is distinct from p_expected_cycle then raise exception 'The SOP changed. Reload before sending.'; end if;
 if s.final_approval_requested_at is not null and s.final_approval_content_hash=s.content_hash then return; end if;
 if s.status='draft' then
   perform public.sign_sop(p_sop,'authorship',null,null,null,p_expected_hash,p_expected_cycle);
   update public.sops set status='in_review' where id=p_sop;
 end if;
 perform public.request_sop_final_approval(p_sop);
end $$;
revoke all on function public.send_sop_for_signatures(text,text,integer) from public,anon;
grant execute on function public.send_sop_for_signatures(text,text,integer) to authenticated;

-- Save the selected mark and bind it to the document without another tab
-- replacing the user's profile between those operations.
create or replace function public.sign_sop_with_mark(p_sop text,p_meaning text,p_strokes jsonb,p_department text,p_hash text,p_cycle integer)
returns text language plpgsql security invoker set search_path = '' as $$
declare existing_id text;
begin
 if auth.uid() is null then raise exception 'Sign in before signing'; end if;
 if p_meaning not in ('dept_approval','quality_approval') then raise exception 'Unsupported signature'; end if;
 if p_hash is null or p_cycle is null then raise exception 'Reload the document before signing'; end if;
 if jsonb_typeof(p_strokes) is distinct from 'array' or jsonb_array_length(p_strokes)=0 then raise exception 'A signature is required'; end if;
 perform 1 from public.sops where id=p_sop and deleted_at is null and content_hash=p_hash and review_cycle=p_cycle for update;
 if not found then raise exception 'The SOP changed or is unavailable. Reload before signing.'; end if;
 select id into existing_id from public.sop_signatures where sop_id=p_sop and signer_id=auth.uid() and meaning=p_meaning and signed_content_hash=p_hash and review_cycle=p_cycle and seat_department_id is not distinct from p_department limit 1;
 if existing_id is not null then return existing_id; end if;
 insert into public.user_signature_profiles(user_id,signature_strokes) values(auth.uid(),p_strokes)
 on conflict(user_id) do update set signature_strokes=excluded.signature_strokes;
 return public.sign_sop(p_sop,p_meaning,null,p_department,null,p_hash,p_cycle);
end $$;
revoke all on function public.sign_sop_with_mark(text,text,jsonb,text,text,integer) from public,anon;
grant execute on function public.sign_sop_with_mark(text,text,jsonb,text,text,integer) to authenticated;
