-- Dedicated cast project; approved policy removes only unfinished uploads older than 48 hours.
create table public.cast_cleanup_control (
  singleton boolean primary key default true check(singleton),
  ticket text not null default encode(extensions.gen_random_bytes(32),'hex'),
  lease uuid,
  lease_until timestamptz
);
alter table public.cast_cleanup_control enable row level security;
revoke all on public.cast_cleanup_control from public,anon,authenticated;
grant select,update on public.cast_cleanup_control to service_role;
insert into public.cast_cleanup_control(singleton) values(true);

create function public.cast_claim_cleanup(ticket text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid;
begin
  update public.cast_cleanup_control c set lease=gen_random_uuid(),lease_until=now()+interval '5 minutes'
    where c.singleton and c.ticket=cast_claim_cleanup.ticket
      and (c.lease is null or c.lease_until<now()) returning c.lease into result;
  return result;
end $$;

create function public.cast_cleanup_candidates(lease_id uuid)
returns table(id uuid) language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.cast_cleanup_control c where c.lease=lease_id and c.lease_until>now())
    then raise exception 'Cleanup lease unavailable'; end if;
  update public.cast_registrations r set status='expired',revision=revision+1,updated_at=now()
    where r.id in (select x.id from public.cast_registrations x
      where x.status='uploading' and x.created_at<now()-interval '48 hours' and x.upload_expires_at<now()
      order by x.created_at limit 20 for update skip locked);
  return query select r.id from public.cast_registrations r
    where r.status='expired' and r.created_at<now()-interval '48 hours'
      and r.upload_expires_at<now() and not exists(select 1 from public.cast_approval_jobs j where j.registration_id=r.id)
    order by r.created_at limit 20;
end $$;

create function public.cast_finish_expired_registration(lease_id uuid,request_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.cast_cleanup_control c where c.lease=lease_id and c.lease_until>now())
    then raise exception 'Cleanup lease unavailable'; end if;
  delete from public.cast_registrations r where r.id=request_id and r.status='expired'
    and r.created_at<now()-interval '48 hours' and r.upload_expires_at<now()
    and not exists(select 1 from public.cast_approval_jobs j where j.registration_id=r.id)
    and not exists(select 1 from public.cast_registration_files f join storage.objects o
      on o.bucket_id='cast-registration-private' and o.name=f.object_path where f.registration_id=r.id);
  if not found then raise exception 'Cleanup incomplete'; end if;
end $$;

create function public.cast_release_cleanup(lease_id uuid)
returns void language sql security invoker set search_path='' as $$
  update public.cast_cleanup_control set lease=null,lease_until=null where lease=lease_id;
$$;

create function public.cast_dispatch_cleanup()
returns void language plpgsql security invoker set search_path='' as $$
declare capability text;
begin
  select ticket into capability from public.cast_cleanup_control where singleton;
  perform net.http_post(url:='https://vmnkdbceyqudcxddvljx.supabase.co/functions/v1/cast-registration-cleanup',
    body:=jsonb_build_object('ticket',capability),headers:='{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds:=5000);
end $$;
revoke all on function public.cast_claim_cleanup(text),public.cast_cleanup_candidates(uuid),
  public.cast_finish_expired_registration(uuid,uuid),public.cast_release_cleanup(uuid),public.cast_dispatch_cleanup()
  from public,anon,authenticated;
grant execute on function public.cast_claim_cleanup(text),public.cast_cleanup_candidates(uuid),
  public.cast_finish_expired_registration(uuid,uuid),public.cast_release_cleanup(uuid),public.cast_dispatch_cleanup()
  to service_role;

-- Schedule only after the cleanup worker is deployed and verified.
-- select cron.schedule('cast-unfinished-upload-cleanup','17 * * * *','select public.cast_dispatch_cleanup();');
