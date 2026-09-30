begin;
do $$
declare probe_id uuid := gen_random_uuid(); result uuid; current_revision integer;
  portrait jsonb := jsonb_build_object('name','portrait.jpg','type','image/jpeg','size',512);
  fields jsonb := jsonb_build_object('name','Synthetic rollback only','gender','male','age',14,
    'height',130,'weight',30,'speaking',false,'whatsapp','+966500000000','worksMode','drive',
    'folderUrl','https://drive.google.com/drive/folders/SyntheticFolderOnly123');
begin
  result := public.cast_reserve_registration(probe_id, repeat('a',64), repeat('b',64), fields, jsonb_build_array(portrait));
  if result <> probe_id then raise exception 'Reservation identity failed'; end if;
  result := public.cast_reserve_registration(probe_id, repeat('a',64), repeat('b',64), fields, jsonb_build_array(portrait));
  if (select count(*) from public.cast_registration_files where registration_id = probe_id) <> 1
    then raise exception 'Retry duplicated files'; end if;
  if (select category from public.cast_registrations where cast_registrations.id = probe_id) <> 'boys'
    then raise exception 'Age classification failed'; end if;
  begin
    perform public.cast_reserve_registration(probe_id, repeat('c',64), repeat('b',64), fields, jsonb_build_array(portrait));
    raise exception 'Accepted wrong ticket';
  exception when others then
    if sqlerrm <> 'Invalid ticket' then raise; end if;
  end;
  begin
    perform public.cast_submit_registration(probe_id, repeat('a',64));
    raise exception 'Submitted missing portrait';
  exception when others then
    if sqlerrm <> 'Media is not verified' then raise; end if;
  end;
  update public.cast_registrations set status='pending' where cast_registrations.id=probe_id;
  select revision into current_revision from public.cast_registrations where cast_registrations.id=probe_id;
  fields := fields || jsonb_build_object('age',50,'ownerNote','private test','reviewedCount',2,'accessible',true);
  perform public.cast_edit_registration(probe_id, current_revision, fields);
  if (select category from public.cast_registrations where cast_registrations.id=probe_id) <> 'seniorMen'
    then raise exception 'Edit classification failed'; end if;
  begin
    perform public.cast_edit_registration(probe_id, current_revision, fields);
    raise exception 'Accepted stale revision';
  exception when sqlstate 'P0003' then null;
  end;
end $$;
rollback;
select jsonb_build_object('records_retained', (select count(*) from public.cast_registrations),
  'anon_reserve', has_function_privilege('anon','public.cast_reserve_registration(uuid,text,text,jsonb,jsonb)','EXECUTE'),
  'anon_edit', has_function_privilege('anon','public.cast_edit_registration(uuid,integer,jsonb)','EXECUTE'),
  'authenticated_submit', has_function_privilege('authenticated','public.cast_submit_registration(uuid,text)','EXECUTE')) as verification;
