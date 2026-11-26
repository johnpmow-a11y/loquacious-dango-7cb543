-- All Ads Manager: private customer-to-ad-platform connection metadata.
-- Provider OAuth tokens remain in Composio and are never stored in Supabase.
create table if not exists public.aam_ad_connections (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  platform text not null check (platform in ('facebook','instagram','tiktok','snapchat')),
  toolkit_slug text not null,
  connected_account_id text not null unique,
  connection_status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists aam_ad_connections_customer_platform_idx
  on public.aam_ad_connections(customer_id, platform, updated_at desc);
alter table public.aam_ad_connections enable row level security;
revoke all on public.aam_ad_connections from anon, authenticated;
