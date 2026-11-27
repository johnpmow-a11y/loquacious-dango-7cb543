-- Optional Audius soundtrack metadata for social posts and 24-hour Status.
-- Additive only; preserves existing posts, statuses, media, logins and balances.
begin;
alter table public.aam_social_posts
  add column if not exists sound_track_id text,
  add column if not exists sound_title text,
  add column if not exists sound_artist text,
  add column if not exists sound_artwork_url text;
alter table public.aam_social_statuses
  add column if not exists sound_track_id text,
  add column if not exists sound_title text,
  add column if not exists sound_artist text,
  add column if not exists sound_artwork_url text;
commit;
