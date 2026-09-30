create table public.cast_registration_integrations (
  id text primary key check (id = 'google-drive'),
  encrypted_connection text not null check (length(encrypted_connection) between 100 and 12000),
  connected_at timestamptz not null default now(),
  root_folder_id text,
  category_folders jsonb not null default '{}'::jsonb
);
alter table public.cast_registration_integrations enable row level security;
revoke all on public.cast_registration_integrations from public, anon, authenticated;
grant all on public.cast_registration_integrations to service_role;
