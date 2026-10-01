begin;
do $$
declare ids uuid[]:='{}'; fixture uuid; attempt uuid:=gen_random_uuid(); n integer;
  fields jsonb:=jsonb_build_object('name','Synthetic quota','gender','female','age',25,
    'height',170,'weight',70,'speaking',true,'whatsapp','+12025550123','worksMode','drive',
    'folderUrl','https://drive.google.com/drive/folders/SyntheticQuotaFolder123');
  files jsonb:=jsonb_build_array(jsonb_build_object('name','portrait.png','type','image/png','size',1));
begin
  for n in 1..11 loop
    fixture:=gen_random_uuid();ids:=array_append(ids,fixture);
    insert into public.cast_registrations(id,name,gender,age,height,weight,speaking,whatsapp,works_mode,submission_token_hash)
      values(fixture,'Synthetic quota','female',25,170,70,true,'+12025550123','upload',repeat('a',64));
    insert into public.cast_registration_files(registration_id,slot,original_name,mime_type,declared_size,object_path)
      select fixture,slot,'synthetic.png','image/png',1,fixture::text||'/'||slot||'/'||gen_random_uuid()::text
      from generate_series(0,9) slot;
  end loop;
  begin
    perform public.cast_reserve_registration(attempt,repeat('a',64),repeat('c',64),fields,files);
    raise exception 'Unverified worst-case capacity was not reserved';
  exception when sqlstate 'P0002' then null; end;
  update public.cast_registration_files set verified_at=now(),verified_size=declared_size where registration_id=any(ids);
  perform public.cast_reserve_registration(attempt,repeat('a',64),repeat('c',64),fields,files);
  if not exists(select 1 from public.cast_registrations where id=attempt)
    then raise exception 'Verified immutable small files still reserve full bucket limit'; end if;
  update public.cast_registrations set client_fingerprint=repeat('c',64) where id=any(ids);
  begin
    perform public.cast_reserve_registration(gen_random_uuid(),repeat('a',64),repeat('c',64),fields,files);
    raise exception 'Per-client daily limit failed';
  exception when sqlstate 'P0002' then null; end;
end $$;
rollback;
select count(*) as retained_quota_fixtures from public.cast_registrations where name='Synthetic quota';
