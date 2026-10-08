create function public.cast_set_official_drive(sealed_connection text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if sealed_connection is null or length(sealed_connection) not between 100 and 12000 then raise exception 'Invalid connection'; end if;
  perform 1 from public.cast_registration_integrations where id='google-drive' for update;
  if exists(select 1 from public.cast_approval_jobs where status <> 'done') then
    raise exception 'Active approval' using errcode='P0003';
  end if;
  insert into public.cast_registration_integrations(id,encrypted_connection,connected_at,root_folder_id,category_folders)
  values('google-drive',sealed_connection,now(),'1kyQALMt95YXHjd0wz3d0tbqRyAm3ukYi',
    '{"men":"1HDmnn0FPRygHRcDlQ5rxSmXO7Mb8-2Em","women":"1KnOz1YcGIcmAE0AYu8TK2ivAM2yx8o9S","boys":"17yLXyTsPQdRJLlTXWfFKN8XtTKTdiuQE","girls":"1yAKNbIoiNgLX2Sd6xFQxl9waRHwwO2FZ","seniorMen":"1T1G7dpLw5NYviMMjqMTeot8G1AkcssMj","seniorWomen":"1dwFnfjPSYxVFxMziHa1ZNIlGGeyj9qLc"}'::jsonb)
  on conflict(id) do update set encrypted_connection=excluded.encrypted_connection,connected_at=excluded.connected_at,
    root_folder_id=excluded.root_folder_id,category_folders=excluded.category_folders;
end $$;
revoke all on function public.cast_set_official_drive(text) from public,anon,authenticated;
grant execute on function public.cast_set_official_drive(text) to service_role;
