-- All Ads Manager: persistent ownership map for customer-created advertising campaigns.
-- This lets the existing customer Inbox route each ad conversation to its owner.
create table if not exists public.aam_ad_campaign_assets (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  platform text not null check (platform in ('facebook','instagram','tiktok')),
  toolkit_slug text not null,
  connected_account_id text not null,
  ad_account_id text,
  campaign_id text,
  ad_set_id text,
  ad_group_id text,
  creative_id text,
  ad_id text,
  page_id text,
  post_id text,
  object_story_id text,
  provider_result jsonb not null default '{}'::jsonb,
  sync_cursor text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists aam_ad_campaign_assets_owner_platform_campaign_uidx
  on public.aam_ad_campaign_assets(customer_id, platform, campaign_id)
  where campaign_id is not null;
create index if not exists aam_ad_campaign_assets_customer_idx
  on public.aam_ad_campaign_assets(customer_id, platform, updated_at desc);
create index if not exists aam_ad_campaign_assets_post_idx
  on public.aam_ad_campaign_assets(platform, post_id)
  where post_id is not null;

-- External ad conversations/messages are stored separately from private customer chats,
-- but are merged into the same Inbox API/UI. No public or authenticated direct access.
create table if not exists public.aam_ad_inbox_threads (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  campaign_asset_id uuid references public.aam_ad_campaign_assets(id) on delete set null,
  platform text not null check (platform in ('facebook','instagram','tiktok')),
  provider_thread_id text not null,
  provider_post_id text,
  provider_ad_id text,
  thread_title text not null default 'Ad conversation',
  sender_name text,
  sender_avatar_url text,
  last_message text,
  last_message_at timestamptz not null default now(),
  unread_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id, platform, provider_thread_id)
);
create index if not exists aam_ad_inbox_threads_customer_idx
  on public.aam_ad_inbox_threads(customer_id, last_message_at desc);

create table if not exists public.aam_ad_inbox_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.aam_ad_inbox_threads(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  provider_message_id text not null,
  sender_name text not null default 'Ad visitor',
  sender_external_id text,
  message_text text not null default '',
  message_kind text not null default 'comment' check (message_kind in ('comment','reply','messenger','direct')),
  is_from_customer boolean not null default false,
  provider_parent_message_id text,
  provider_created_at timestamptz,
  created_at timestamptz not null default now(),
  unique(thread_id, provider_message_id)
);
create index if not exists aam_ad_inbox_messages_thread_idx
  on public.aam_ad_inbox_messages(thread_id, provider_created_at asc);

alter table public.aam_ad_campaign_assets enable row level security;
alter table public.aam_ad_inbox_threads enable row level security;
alter table public.aam_ad_inbox_messages enable row level security;
revoke all on public.aam_ad_campaign_assets, public.aam_ad_inbox_threads, public.aam_ad_inbox_messages from anon, authenticated;
grant all on public.aam_ad_campaign_assets, public.aam_ad_inbox_threads, public.aam_ad_inbox_messages to service_role;
