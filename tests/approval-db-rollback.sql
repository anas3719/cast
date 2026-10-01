-- Synthetic rows only; all state changes roll back, including folder allocations.
begin;
set local role service_role;
do $$
declare request uuid:=gen_random_uuid(); item uuid; result jsonb; ids jsonb;
  job public.cast_approval_jobs; claimed public.cast_approval_jobs; second public.cast_approval_jobs;
begin
  insert into public.cast_registrations(id,status,name,gender,age,height,weight,speaking,whatsapp,works_mode,submission_token_hash)
  values(request,'pending','Synthetic rollback','male',25,170,70,true,'+966500000000','upload',repeat('a',64));
  for n in 0..2 loop
    insert into public.cast_registration_files(registration_id,slot,original_name,mime_type,declared_size,object_path,verified_at,verified_size)
    values(request,n,'synthetic.jpg','image/jpeg',100,request::text||'/'||n||'/'||gen_random_uuid()::text,now(),100);
  end loop;
  select jsonb_agg('synthetic-drive-'||lpad(n::text,3,'0')) into ids from generate_series(0,18) n;
  result:=public.cast_start_approval(request,1,ids);
  select * into job from public.cast_approval_jobs where registration_id=request;
  assert job.revision=2 and job.status='needs_grant';
  begin
    perform public.cast_start_approval(request,1,ids);
    raise exception 'Expected revision rejection';
  exception when sqlstate 'P0003' then null; end;
  perform public.cast_attach_approval_grant(job.id,job.revision,repeat('x',150));
  claimed:=public.cast_claim_approval(job.id,job.tick_token);
  second:=public.cast_claim_approval(job.id,job.tick_token);
  assert claimed.lease is not null and second.id is null;
  begin
    perform public.cast_checkpoint_approval(job.id,gen_random_uuid(),1);
    raise exception 'Expected lease rejection';
  exception when sqlstate 'P0003' then null; end;
  perform public.cast_checkpoint_approval(job.id,claimed.lease,1);
  begin
    perform public.cast_checkpoint_approval(job.id,claimed.lease,5,commit_id=>repeat('a',40));
    raise exception 'Expected phase rejection';
  exception when raise_exception then
    if sqlerrm<>'Invalid phase' then raise; end if;
  end;
  for item in select id from public.cast_registration_files where registration_id=request loop
    perform public.cast_checkpoint_approval(job.id,claimed.lease,1,file_id=>item,transferred=>100);
  end loop;
  perform public.cast_checkpoint_approval(job.id,claimed.lease,2);
  perform public.cast_checkpoint_approval(job.id,claimed.lease,3);
  perform public.cast_checkpoint_approval(job.id,claimed.lease,4,commit_id=>repeat('a',40));
  perform public.cast_checkpoint_approval(job.id,claimed.lease,5,commit_id=>repeat('a',40));
  assert (select status='approved' and published_commit=repeat('a',40) from public.cast_registrations where id=request);
  assert (select status='done' from public.cast_approval_jobs where id=job.id);
  assert not has_table_privilege('anon','public.cast_approval_jobs','select');
  assert not has_function_privilege('authenticated','public.cast_claim_approval(uuid,text)','execute');
end $$;
rollback;
select count(*) as existing_requests_after_rollback from public.cast_registrations;
