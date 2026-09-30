-- Apply only to the dedicated cast-registrations project.
create table public.cast_registrations (
  id uuid primary key default gen_random_uuid(),
  profile_id text generated always as ('registration-' || id::text) stored unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  status text not null default 'uploading'
    check (status in ('uploading', 'pending', 'approving', 'approved', 'rejected', 'expired')),
  name text not null check (length(btrim(name)) between 1 and 120),
  gender text not null check (gender in ('male', 'female')),
  age integer not null check (age between 0 and 120),
  height numeric(5,2) not null check (height > 0 and height <= 250),
  weight numeric(5,2) not null check (weight > 0 and weight <= 300),
  nationality text not null default '' check (length(nationality) <= 80),
  speaking boolean not null,
  whatsapp text not null check (whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  category text generated always as (
    case when age < 15 then case when gender = 'male' then 'boys' else 'girls' end
      when age >= 50 then case when gender = 'male' then 'seniorMen' else 'seniorWomen' end
      else case when gender = 'male' then 'men' else 'women' end end
  ) stored,
  works_mode text not null check (works_mode in ('drive', 'upload')),
  supplied_folder_url text,
  drive_reviewed_count integer check (drive_reviewed_count between 2 and 10),
  drive_access_verified boolean not null default false,
  submission_token_hash text not null check (submission_token_hash ~ '^[a-f0-9]{64}$'),
  upload_expires_at timestamptz not null default (now() + interval '24 hours'),
  drive_folder_id text,
  drive_portrait_id text,
  approval_lease uuid,
  lease_expires_at timestamptz,
  published_commit text check (published_commit ~ '^[a-f0-9]{40}$'),
  published_at timestamptz,
  owner_note text not null default '' check (length(owner_note) <= 4000),
  check (works_mode <> 'drive' or (supplied_folder_url is not null
    and supplied_folder_url ~ '^https://drive\.google\.com/drive/folders/[A-Za-z0-9_-]{10,100}$'))
);

create index cast_registrations_status_created_idx
  on public.cast_registrations (status, created_at desc);

create table public.cast_registration_files (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.cast_registrations(id) on delete cascade,
  slot smallint not null check (slot between 0 and 10),
  role text generated always as (case when slot = 0 then 'portrait' else 'work' end) stored,
  original_name text not null check (length(original_name) between 1 and 255),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp',
    'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/webm')),
  declared_size bigint not null check (declared_size > 0 and declared_size <= 2147483648),
  object_path text not null unique,
  verified_at timestamptz,
  verified_size bigint check (verified_size > 0 and verified_size <= 2147483648),
  drive_file_id text,
  drive_upload_url text,
  transferred_bytes bigint not null default 0 check (transferred_bytes >= 0),
  unique (registration_id, slot),
  check (slot <> 0 or mime_type like 'image/%'),
  check (object_path like registration_id::text || '/%'),
  check (verified_at is null or verified_size = declared_size)
);

create table public.cast_registration_events (
  id bigint generated always as identity primary key,
  registration_id uuid not null references public.cast_registrations(id) on delete cascade,
  created_at timestamptz not null default now(),
  action text not null check (action in ('submitted', 'edited', 'approval_started',
    'media_ready', 'published', 'rejected', 'expired', 'approval_failed')),
  revision integer not null check (revision > 0)
);

-- No browser role may read/write contacts, submissions, or transfer credentials.
alter table public.cast_registrations enable row level security;
alter table public.cast_registration_files enable row level security;
alter table public.cast_registration_events enable row level security;
revoke all on public.cast_registrations, public.cast_registration_files,
  public.cast_registration_events from public, anon, authenticated;
revoke all on sequence public.cast_registration_events_id_seq from public, anon, authenticated;
grant select, insert, update, delete on public.cast_registrations,
  public.cast_registration_files, public.cast_registration_events to service_role;
grant usage, select on sequence public.cast_registration_events_id_seq to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cast-registration-private', 'cast-registration-private', false, 2147483648,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'video/mp4', 'video/quicktime', 'video/webm']);
-- Do not add public storage policies. The server issues object-scoped signed URLs.
