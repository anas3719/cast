-- Only the dedicated cast-registrations project.
alter table public.cast_registrations add column client_fingerprint text
  check (client_fingerprint ~ '^[a-f0-9]{64}$');

create function public.cast_reserve_registration(
  request_id uuid, ticket_hash text, fingerprint text, fields jsonb, files jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare previous public.cast_registrations; item jsonb; ordinal integer;
  expected_count integer; declared_bytes bigint;
begin
  if jsonb_typeof(files) <> 'array' then raise exception 'Invalid manifest'; end if;
  expected_count := jsonb_array_length(files);
  if (fields->>'worksMode' = 'drive' and expected_count <> 1)
    or (fields->>'worksMode' = 'upload' and expected_count not between 3 and 11)
    then raise exception 'Invalid manifest count'; end if;
  perform pg_advisory_xact_lock(1344212817);
  select * into previous from public.cast_registrations where id = request_id;
  if found then
    if previous.submission_token_hash <> ticket_hash then raise exception 'Invalid ticket'; end if;
    return request_id;
  end if;
  select sum((f->>'size')::bigint) into declared_bytes from jsonb_array_elements(files) f;
  if declared_bytes is null or declared_bytes > 23622320128 then raise exception 'Invalid manifest bytes'; end if;
  if (select count(*) from public.cast_registrations
      where created_at > now() - interval '1 day' and client_fingerprint = fingerprint) >= 10
    or (select count(*) from public.cast_registrations where created_at > now() - interval '1 day') >= 100
    -- Signed uploads are object-bound, not declaration-size-bound. Reserve the
    -- worst-case bucket limit until that file's storage cleanup is complete.
    or (select count(*) from public.cast_registration_files) * 2147483648
      + expected_count * 2147483648::bigint > 214748364800
    then raise exception 'Registration quota reached' using errcode = 'P0002'; end if;
  insert into public.cast_registrations(id, submission_token_hash, client_fingerprint,
    name, gender, age, height, weight, nationality, speaking, whatsapp, works_mode, supplied_folder_url)
  values (request_id, ticket_hash, fingerprint, fields->>'name', fields->>'gender',
    (fields->>'age')::integer, (fields->>'height')::numeric, (fields->>'weight')::numeric,
    coalesce(fields->>'nationality', ''), (fields->>'speaking')::boolean,
    fields->>'whatsapp', fields->>'worksMode', nullif(fields->>'folderUrl', ''));
  for item, ordinal in select value, ordinality::integer - 1 from jsonb_array_elements(files) with ordinality
  loop
    insert into public.cast_registration_files(registration_id, slot, original_name, mime_type, declared_size, object_path)
    values (request_id, ordinal, item->>'name', item->>'type', (item->>'size')::bigint,
      request_id::text || '/' || ordinal::text || '/' || gen_random_uuid()::text);
  end loop;
  return request_id;
end $$;

create function public.cast_submit_registration(request_id uuid, ticket_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare record public.cast_registrations; total integer;
begin
  select * into record from public.cast_registrations where id = request_id for update;
  if not found or record.submission_token_hash <> ticket_hash then raise exception 'Invalid ticket'; end if;
  if record.status = 'pending' then return 'pending'; end if;
  if record.status <> 'uploading' or record.upload_expires_at < now() then raise exception 'Upload expired'; end if;
  select count(*) into total from public.cast_registration_files where registration_id = request_id;
  if total < 1 or exists (
    select 1 from public.cast_registration_files f left join storage.objects o
      on o.bucket_id = 'cast-registration-private' and o.name = f.object_path
    where f.registration_id = request_id and (f.verified_at is null or o.id is null
      or (o.metadata->>'size')::bigint is distinct from f.declared_size
      or o.metadata->>'mimetype' is distinct from f.mime_type))
    then raise exception 'Media is not verified'; end if;
  update public.cast_registrations set status = 'pending', updated_at = now() where id = request_id;
  insert into public.cast_registration_events(registration_id, action, revision)
    values (request_id, 'submitted', record.revision);
  return 'pending';
end $$;

create function public.cast_edit_registration(request_id uuid, expected_revision integer, fields jsonb)
returns public.cast_registrations language plpgsql security definer set search_path = '' as $$
declare result public.cast_registrations;
begin
  update public.cast_registrations set name = fields->>'name', gender = fields->>'gender',
    age = (fields->>'age')::integer, height = (fields->>'height')::numeric,
    weight = (fields->>'weight')::numeric, nationality = coalesce(fields->>'nationality', ''),
    speaking = (fields->>'speaking')::boolean, whatsapp = fields->>'whatsapp',
    owner_note = coalesce(fields->>'ownerNote', ''),
    drive_reviewed_count = nullif(fields->>'reviewedCount', '')::integer,
    drive_access_verified = coalesce((fields->>'accessible')::boolean, false),
    updated_at = now(), revision = revision + 1
  where id = request_id and revision = expected_revision and status in ('pending', 'approved') returning * into result;
  if not found then raise exception 'Revision conflict' using errcode = 'P0003'; end if;
  insert into public.cast_registration_events(registration_id, action, revision)
    values (request_id, 'edited', result.revision);
  return result;
end $$;

revoke all on function public.cast_reserve_registration(uuid,text,text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.cast_submit_registration(uuid,text) from public, anon, authenticated;
revoke all on function public.cast_edit_registration(uuid,integer,jsonb) from public, anon, authenticated;
grant execute on function public.cast_reserve_registration(uuid,text,text,jsonb,jsonb) to service_role;
grant execute on function public.cast_submit_registration(uuid,text) to service_role;
grant execute on function public.cast_edit_registration(uuid,integer,jsonb) to service_role;
