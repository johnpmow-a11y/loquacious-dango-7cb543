-- Allow text-only social posts with selectable background themes.
alter table public.aam_social_posts
  alter column media_path drop not null;
alter table public.aam_social_posts
  drop constraint if exists aam_social_posts_media_type_check;
alter table public.aam_social_posts
  add constraint aam_social_posts_media_type_check check (media_type in ('image','video','text'));
alter table public.aam_social_posts
  add column if not exists background_color text;
alter table public.aam_social_posts
  add constraint aam_social_text_post_content check (
    (media_type = 'text' and media_path is null and length(trim(caption)) > 0 and background_color is not null)
    or (media_type in ('image','video') and media_path is not null)
  );
