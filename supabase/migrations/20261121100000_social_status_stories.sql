-- Additive 24-hour customer Status feature. Existing social tables and login remain unchanged.
begin;
create table if not exists public.aam_social_statuses (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.customers(id) on delete cascade,
 status_type text not null check (status_type in ('text','image','video')),
 body text not null default '',
 media_path text,
 background text not null default '#087443',
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '24 hours',
 constraint aam_social_status_content check ((status_type='text' and length(body) between 1 and 700 and media_path is null) or (status_type in ('image','video') and media_path is not null and length(body)<=700))
);
create index if not exists aam_social_statuses_active_idx on public.aam_social_statuses(expires_at desc,created_at desc);
create table if not exists public.aam_social_status_views (
 status_id uuid not null references public.aam_social_statuses(id) on delete cascade,
 viewer_id uuid not null references public.customers(id) on delete cascade,
 viewed_at timestamptz not null default now(),
 primary key(status_id,viewer_id)
);
alter table public.aam_social_statuses enable row level security;
alter table public.aam_social_status_views enable row level security;
revoke all on public.aam_social_statuses,public.aam_social_status_views from public,anon,authenticated;
grant all on public.aam_social_statuses,public.aam_social_status_views to service_role;
commit;
