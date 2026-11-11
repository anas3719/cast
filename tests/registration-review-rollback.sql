begin;
do $test$
declare probe uuid := gen_random_uuid(); revision integer; result jsonb; ids jsonb;
  fields jsonb := jsonb_build_object('name','Synthetic review rollback only','gender','male','age',25,
    'height',175,'weight',70,'speaking',true,'whatsapp','+966500000000','worksMode','drive',
    'folderUrl','https://drive.google.com/drive/folders/SyntheticFolderOnly123');
begin
  perform public.cast_reserve_registration(probe,repeat('a',64),repeat('b',64),fields,
    jsonb_build_array(jsonb_build_object('name','portrait.jpg','type','image/jpeg','size',512)));
  update public.cast_registrations set status='pending' where id=probe;
  update public.cast_registration_files set verified_at=now(),verified_size=declared_size where registration_id=probe;
  select jsonb_agg('SyntheticReviewDriveId'||n order by n) into ids from generate_series(0,18) n;
  select r.revision into revision from public.cast_registrations r where id=probe;
  begin
    perform public.cast_start_approval(probe,revision,ids);
    raise exception 'Unchecked review was accepted';
  exception when others then
    if sqlerrm <> 'Media not ready' then raise; end if;
  end;
  perform public.cast_edit_registration(probe,revision,fields||jsonb_build_object('accessible',true));
  if exists(select 1 from public.cast_registrations where id=probe and drive_reviewed_count is not null)
    then raise exception 'Invented work count'; end if;
  select r.revision into revision from public.cast_registrations r where id=probe;
  update public.cast_registration_files set verified_at=null where registration_id=probe;
  begin
    perform public.cast_start_approval(probe,revision,ids);
    raise exception 'Unverified portrait was accepted';
  exception when others then
    if sqlerrm <> 'Media not ready' then raise; end if;
  end;
  update public.cast_registration_files set verified_at=now() where registration_id=probe;
  result := public.cast_start_approval(probe,revision,ids);
  if result->'record'->>'status' <> 'approving' or result->'job'->>'status' <> 'needs_grant'
    then raise exception 'Reviewed Drive profile without count could not start approval'; end if;
  begin
    perform public.cast_start_approval(probe,revision,ids);
    raise exception 'Stale revision was accepted';
  exception when sqlstate 'P0003' then null;
  end;
end $test$;
rollback;
select not exists(select 1 from public.cast_registrations where name='Synthetic review rollback only') as no_fixture_retained,
  not has_function_privilege('anon','public.cast_start_approval(uuid,integer,jsonb)','EXECUTE') as anon_blocked,
  not has_function_privilege('authenticated','public.cast_start_approval(uuid,integer,jsonb)','EXECUTE') as authenticated_blocked;
