-- Install only after the authenticated worker deployment. The cron command has no credential literal.
create extension if not exists pg_net;
create extension if not exists pg_cron;

create function public.cast_wake_approval(job_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare j public.cast_approval_jobs;
begin
  select * into j from public.cast_approval_jobs where id=job_id;
  if j.encrypted_grant is null or j.status not in ('queued','retry','running') then return; end if;
  perform net.http_post(url:='https://vmnkdbceyqudcxddvljx.supabase.co/functions/v1/cast-registration-work',
    body:=jsonb_build_object('jobId',j.id,'ticket',j.tick_token),headers:='{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds:=5000);
end $$;
create function public.cast_dispatch_approvals()
returns void language plpgsql security invoker set search_path='' as $$
declare job_id uuid;
begin
  for job_id in select id from public.cast_approval_jobs where encrypted_grant is not null and next_attempt_at<=now()
    and (status in ('queued','retry') or (status='running' and lease_until<now()))
    order by next_attempt_at limit 5 loop
    perform public.cast_wake_approval(job_id);
  end loop;
end $$;
revoke all on function public.cast_wake_approval(uuid),public.cast_dispatch_approvals() from public,anon,authenticated;
grant execute on function public.cast_wake_approval(uuid),public.cast_dispatch_approvals() to service_role;
select cron.schedule('cast-approved-media-worker','* * * * *','select public.cast_dispatch_approvals();');
