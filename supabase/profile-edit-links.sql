create table public.cast_profile_edit_links (
  profile_id text primary key check (profile_id ~ '^[a-zA-Z0-9_-]{1,120}$'),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  simple boolean not null default false,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  proposal jsonb check (proposal is null or jsonb_typeof(proposal) = 'object'),
  revision uuid not null default gen_random_uuid(),
  submitted_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.cast_profile_edit_links enable row level security;
revoke all on public.cast_profile_edit_links from public, anon, authenticated;
grant select, insert, update on public.cast_profile_edit_links to service_role;
create index cast_profile_edit_pending on public.cast_profile_edit_links (submitted_at desc) where proposal is not null;
