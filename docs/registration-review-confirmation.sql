-- Cast project only. Preserve function identity, grants and all other guards.
do $migration$
declare definition text;
  previous text := 'or (r.works_mode=''drive'' and (not r.drive_access_verified or r.drive_reviewed_count is null))';
  replacement text := 'or (r.works_mode=''drive'' and not r.drive_access_verified)';
begin
  definition := pg_get_functiondef('public.cast_start_approval(uuid,integer,jsonb)'::regprocedure);
  if position(previous in definition) = 0 then
    if position(replacement in definition) > 0 then return; end if;
    raise exception 'Unexpected approval guard; migration stopped';
  end if;
  execute replace(definition, previous, replacement);
end $migration$;
