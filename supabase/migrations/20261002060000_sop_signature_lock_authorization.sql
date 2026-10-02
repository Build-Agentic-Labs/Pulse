-- Assigned approvers can read a routed SOP but intentionally cannot UPDATE it.
-- The invoker-mode FOR UPDATE was filtered by UPDATE RLS and falsely reported a
-- stale document. Only this transaction helper needs owner privilege for locking.
-- auth.uid() is unchanged: profile writes remain scoped to the caller, and sign_sop
-- still enforces current seat membership, author separation, Quality eligibility,
-- document hash/cycle and approval phase. Any rejected signature rolls back the
-- mark update and signature together. can_read_sop guards the privileged lookup.
create or replace function public.sign_sop_with_mark(p_sop text,p_meaning text,p_strokes jsonb,p_department text,p_hash text,p_cycle integer)
returns text language plpgsql security definer set search_path = '' as $$
declare existing_id text;
begin
 if auth.uid() is null then raise exception 'Sign in before signing'; end if;
 if not public.can_read_sop(p_sop) then raise exception 'This SOP is unavailable'; end if;
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
