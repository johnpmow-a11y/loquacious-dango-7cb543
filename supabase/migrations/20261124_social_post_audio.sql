-- Optional audio tracks attached to photo/video social posts.
alter table public.aam_social_posts
  add column if not exists audio_path text;
