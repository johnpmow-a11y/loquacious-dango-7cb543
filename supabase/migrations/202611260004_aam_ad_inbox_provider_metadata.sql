-- Preserve provider-specific ad comment fields needed for safe replies (notably TikTok identity metadata).
alter table public.aam_ad_inbox_messages
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;

alter table public.aam_ad_campaign_assets
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;
