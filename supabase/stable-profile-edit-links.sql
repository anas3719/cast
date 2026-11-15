alter table public.cast_profile_edit_links add column encrypted_token text;
alter table public.cast_profile_edit_links alter column expires_at drop not null;
update public.cast_profile_edit_links set expires_at=null;
