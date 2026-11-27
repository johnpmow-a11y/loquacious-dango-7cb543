-- Extend private advertising connection and campaign ownership records for WhatsApp click-to-message campaigns.
-- WhatsApp Ads are created through Meta Ads; this adds the platform label without creating a separate WhatsApp Ads API.
alter table public.aam_ad_connections drop constraint if exists aam_ad_connections_platform_check;
alter table public.aam_ad_connections add constraint aam_ad_connections_platform_check
  check (platform in ('facebook','instagram','tiktok','snapchat','whatsapp'));

alter table public.aam_ad_campaign_assets drop constraint if exists aam_ad_campaign_assets_platform_check;
alter table public.aam_ad_campaign_assets add constraint aam_ad_campaign_assets_platform_check
  check (platform in ('facebook','instagram','tiktok','whatsapp'));

alter table public.aam_ad_inbox_threads drop constraint if exists aam_ad_inbox_threads_platform_check;
alter table public.aam_ad_inbox_threads add constraint aam_ad_inbox_threads_platform_check
  check (platform in ('facebook','instagram','tiktok','whatsapp'));
