-- Dedicated cast project only. No anonymous/browser grants.
create table public.cast_approval_jobs (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique references public.cast_registrations(id),
  revision integer not null,
  status text not null default 'needs_grant' check (status in ('needs_grant','queued','running','retry','needs_owner','done')),
  phase integer not null default 0 check (phase between 0 and 5),
  encrypted_grant text,
  tick_token text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  lease uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  error_code text check (error_code in ('connection','retry','conflict','expired')),
  commit_sha text check (commit_sha ~ '^[a-f0-9]{40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.cast_approval_jobs enable row level security;
revoke all on public.cast_approval_jobs from public, anon, authenticated;
grant select,insert,update,delete on public.cast_approval_jobs to service_role;
create index cast_approval_jobs_due_idx on public.cast_approval_jobs(status,next_attempt_at);

create function public.cast_start_approval(request_id uuid, expected_revision integer, allocated_ids jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.cast_registrations; j public.cast_approval_jobs; i public.cast_registration_integrations;
  f public.cast_registration_files; n integer := 8; category_key text;
begin
  select * into r from public.cast_registrations where id=request_id for update;
  if not found or r.revision <> expected_revision or r.status not in ('pending','approving','approved')
    then raise exception 'Revision conflict' using errcode='P0003'; end if;
  select * into j from public.cast_approval_jobs where registration_id=request_id;
  if r.status='approving' then return jsonb_build_object('job',to_jsonb(j),'record',to_jsonb(r)); end if;
  if (select count(*) from public.cast_registration_files where registration_id=request_id)
       not between (case when r.works_mode='drive' then 1 else 3 end) and (case when r.works_mode='drive' then 1 else 11 end)
    or not exists(select 1 from public.cast_registration_files where registration_id=request_id and slot=0)
    or exists(select 1 from public.cast_registration_files where registration_id=request_id and verified_at is null)
    or (r.works_mode='drive' and (not r.drive_access_verified or r.drive_reviewed_count is null))
    then raise exception 'Media not ready'; end if;
  select * into i from public.cast_registration_integrations where id='google-drive' for update;
  if not found then raise exception 'Drive not connected'; end if;
  if jsonb_typeof(allocated_ids)<>'array' or jsonb_array_length(allocated_ids)<>19
    or exists(select 1 from jsonb_array_elements_text(allocated_ids) x where x !~ '^[A-Za-z0-9_-]{10,100}$')
    or (select count(distinct x) from jsonb_array_elements_text(allocated_ids) x)<>19
    then raise exception 'Invalid allocated IDs'; end if;
  i.root_folder_id := coalesce(i.root_folder_id, allocated_ids->>0);
  foreach category_key in array array['men','women','boys','girls','seniorMen','seniorWomen'] loop
    if not (i.category_folders ? category_key) then
      i.category_folders := jsonb_set(i.category_folders,array[category_key],allocated_ids->(array_position(array['men','women','boys','girls','seniorMen','seniorWomen'],category_key)));
    end if;
  end loop;
  update public.cast_registration_integrations set root_folder_id=i.root_folder_id,category_folders=i.category_folders where id=i.id;
  update public.cast_registrations set status='approving',revision=revision+1,
    drive_folder_id=coalesce(drive_folder_id,allocated_ids->>7),updated_at=now() where id=request_id returning * into r;
  for f in select * from public.cast_registration_files where registration_id=request_id order by slot loop
    update public.cast_registration_files set drive_file_id=coalesce(drive_file_id,allocated_ids->>n) where id=f.id;
    n := n+1;
  end loop;
  insert into public.cast_approval_jobs(registration_id,revision) values(request_id,r.revision)
    on conflict(registration_id) do update set revision=excluded.revision,status='needs_grant',phase=0,
      encrypted_grant=null,lease=null,lease_until=null,commit_sha=null,error_code=null,attempts=0,updated_at=now()
    returning * into j;
  insert into public.cast_registration_events(registration_id,action,revision) values(request_id,'approval_started',r.revision);
  return jsonb_build_object('job',to_jsonb(j),'record',to_jsonb(r));
end $$;

create function public.cast_attach_approval_grant(job_id uuid, expected_revision integer, sealed_grant text)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if length(sealed_grant) not between 100 and 24000 then raise exception 'Invalid grant'; end if;
  update public.cast_approval_jobs set encrypted_grant=sealed_grant,status='queued',error_code=null,
    next_attempt_at=now(),updated_at=now()
    where id=job_id and revision=expected_revision and status in ('needs_grant','needs_owner');
  if not found then raise exception 'Revision conflict' using errcode='P0003'; end if;
end $$;

create function public.cast_claim_approval(job_id uuid, ticket text)
returns public.cast_approval_jobs language plpgsql security invoker set search_path='' as $$
declare j public.cast_approval_jobs;
begin
  update public.cast_approval_jobs set status='running',lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now()
  where id=job_id and tick_token=ticket and encrypted_grant is not null and next_attempt_at<=now()
    and (status in ('queued','retry') or (status='running' and lease_until<now())) returning * into j;
  return j;
end $$;

create function public.cast_checkpoint_approval(job_id uuid, lease_id uuid, new_phase integer,
  file_id uuid default null, upload_handle text default null, transferred bigint default null,
  commit_id text default null, failure text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare j public.cast_approval_jobs; r public.cast_registrations;
begin
  select * into j from public.cast_approval_jobs where id=job_id for update;
  if not found or j.lease is distinct from lease_id or j.lease_until<now() or j.status<>'running'
    then raise exception 'Lease conflict' using errcode='P0003'; end if;
  select * into r from public.cast_registrations where id=j.registration_id for update;
  if r.revision<>j.revision or r.status<>'approving' then raise exception 'Revision conflict' using errcode='P0003'; end if;
  if new_phase is null or new_phase<j.phase or new_phase>least(5,j.phase+1) then raise exception 'Invalid phase'; end if;
  if new_phase>=4 and coalesce(commit_id,j.commit_sha) is null then raise exception 'Commit required'; end if;
  if file_id is not null then
    update public.cast_registration_files set drive_upload_url=upload_handle,transferred_bytes=transferred
      where id=file_id and registration_id=r.id and transferred between 0 and declared_size;
    if not found then raise exception 'Invalid file checkpoint'; end if;
  end if;
  if new_phase=5 then
    if commit_id !~ '^[a-f0-9]{40}$' or commit_id is null or exists(select 1 from public.cast_registration_files
      where registration_id=r.id and transferred_bytes<>declared_size) then raise exception 'Publication incomplete'; end if;
    update public.cast_registrations set status='approved',published_commit=commit_id,published_at=now(),updated_at=now(),
      drive_portrait_id=(select drive_file_id from public.cast_registration_files where registration_id=r.id and slot=0) where id=r.id;
    insert into public.cast_registration_events(registration_id,action,revision) values(r.id,'published',r.revision);
  end if;
  update public.cast_approval_jobs set phase=new_phase,commit_sha=coalesce(commit_id,commit_sha),
    status=case when new_phase=5 then 'done' when failure in ('connection','expired') then 'needs_owner'
      when failure is not null then 'retry' else 'running' end,
    error_code=failure,attempts=case when failure is null then attempts else attempts+1 end,
    next_attempt_at=case when failure is null then now() else now()+interval '1 minute'*least(60,power(2,least(attempts,6))::int) end,
    lease=case when new_phase=5 or failure is not null then null else lease end,
    lease_until=case when new_phase=5 or failure is not null then null else now()+interval '5 minutes' end,updated_at=now()
    where id=j.id;
end $$;

create function public.cast_release_approval(job_id uuid,lease_id uuid)
returns void language sql security invoker set search_path='' as $$
  update public.cast_approval_jobs set status='queued',lease=null,lease_until=null,updated_at=now()
  where id=job_id and lease=lease_id and status='running';
$$;

revoke all on function public.cast_start_approval(uuid,integer,jsonb),
  public.cast_attach_approval_grant(uuid,integer,text),public.cast_claim_approval(uuid,text),
  public.cast_checkpoint_approval(uuid,uuid,integer,uuid,text,bigint,text,text),public.cast_release_approval(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cast_start_approval(uuid,integer,jsonb),
  public.cast_attach_approval_grant(uuid,integer,text),public.cast_claim_approval(uuid,text),
  public.cast_checkpoint_approval(uuid,uuid,integer,uuid,text,bigint,text,text),public.cast_release_approval(uuid,uuid) to service_role;
