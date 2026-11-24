-- All Ads Manager: stable 10-digit public profile IDs.
-- Safe to run more than once.
create sequence if not exists public.aam_social_public_profile_id_seq
  minvalue 1000000000 maxvalue 9999999999 start with 1000000000;

alter table public.aam_social_profiles
  add column if not exists public_profile_id bigint;

update public.aam_social_profiles
set public_profile_id = nextval('public.aam_social_public_profile_id_seq')
where public_profile_id is null;

alter table public.aam_social_profiles
  alter column public_profile_id set default nextval('public.aam_social_public_profile_id_seq'),
  alter column public_profile_id set not null;

create unique index if not exists aam_social_profiles_public_profile_id_uidx
  on public.aam_social_profiles(public_profile_id);

alter sequence public.aam_social_public_profile_id_seq
  owned by public.aam_social_profiles.public_profile_id;
