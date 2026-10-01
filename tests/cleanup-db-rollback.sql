begin;
do $$
declare old_id uuid:=gen_random_uuid(); recent_id uuid:=gen_random_uuid();
  pending_id uuid:=gen_random_uuid(); approved_id uuid:=gen_random_uuid(); lease_id uuid;
  candidates uuid[];
begin
  insert into public.cast_registrations(id,name,gender,age,height,weight,speaking,whatsapp,
    works_mode,submission_token_hash,created_at,upload_expires_at,status)
  values
    (old_id,'Synthetic cleanup','male',25,170,70,true,'+12025550123','upload',repeat('a',64),now()-interval '49 hours',now()-interval '25 hours','uploading'),
    (recent_id,'Synthetic cleanup','male',25,170,70,true,'+12025550123','upload',repeat('a',64),now()-interval '47 hours',now()-interval '23 hours','uploading'),
    (pending_id,'Synthetic cleanup','male',25,170,70,true,'+12025550123','upload',repeat('a',64),now()-interval '49 hours',now()-interval '25 hours','pending'),
    (approved_id,'Synthetic cleanup','male',25,170,70,true,'+12025550123','upload',repeat('a',64),now()-interval '49 hours',now()-interval '25 hours','approved');
  if public.cast_claim_cleanup(repeat('0',64)) is not null then raise exception 'Wrong cleanup capability accepted'; end if;
  select public.cast_claim_cleanup(ticket) into lease_id from public.cast_cleanup_control;
  if lease_id is null then raise exception 'Cleanup lease unavailable'; end if;
  if (select public.cast_claim_cleanup(ticket) from public.cast_cleanup_control) is not null
    then raise exception 'Duplicate cleanup lease accepted'; end if;
  select array_agg(id) into candidates from public.cast_cleanup_candidates(lease_id);
  if not old_id=any(candidates) or recent_id=any(candidates) or pending_id=any(candidates) or approved_id=any(candidates)
    then raise exception 'Cleanup eligibility incorrect'; end if;
  perform public.cast_finish_expired_registration(lease_id,old_id);
  if exists(select 1 from public.cast_registrations where id=old_id) then raise exception 'Expired record retained'; end if;
  if (select count(*) from public.cast_registrations where id in (recent_id,pending_id,approved_id))<>3
    then raise exception 'Protected records changed'; end if;
  if has_function_privilege('anon','public.cast_dispatch_cleanup()','execute')
    or has_table_privilege('authenticated','public.cast_cleanup_control','select')
    then raise exception 'Cleanup capability publicly accessible'; end if;
  perform public.cast_release_cleanup(lease_id);
end $$;
rollback;
