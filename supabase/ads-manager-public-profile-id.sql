-- All Ads Manager: assign every social profile a unique 10-digit public ID.
-- Run once in the Supabase SQL editor for project ftwhcqrtmfxdzokmudvu.

alter table public.aam_social_profiles
  add column if not exists public_profile_id text;

create or replace function public.aam_generate_public_profile_id()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate text;
begin
  loop
    candidate := floor(1000000000 + random() * 9000000000)::bigint::text;
    exit when not exists (
      select 1 from public.aam_social_profiles
      where public_profile_id = candidate
    );
  end loop;
  return candidate;
end;
$$;

update public.aam_social_profiles
set public_profile_id = public.aam_generate_public_profile_id()
where public_profile_id is null
   or public_profile_id !~ '^[0-9]{10}$';

create unique index if not exists aam_social_profiles_public_profile_id_uidx
  on public.aam_social_profiles (public_profile_id);

create or replace function public.aam_social_set_public_profile_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.public_profile_id is null
     or new.public_profile_id !~ '^[0-9]{10}$' then
    new.public_profile_id := public.aam_generate_public_profile_id();
  end if;
  return new;
end;
$$;

drop trigger if exists aam_social_profiles_public_profile_id_trg
  on public.aam_social_profiles;

create trigger aam_social_profiles_public_profile_id_trg
before insert or update of public_profile_id
on public.aam_social_profiles
for each row
execute function public.aam_social_set_public_profile_id();

alter table public.aam_social_profiles
  add constraint aam_social_profiles_public_profile_id_format_chk
  check (public_profile_id ~ '^[0-9]{10}$');
