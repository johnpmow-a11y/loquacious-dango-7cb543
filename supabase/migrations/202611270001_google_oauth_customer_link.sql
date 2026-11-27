-- All Ads Manager: Google OAuth customer linking
-- Run once in Supabase SQL Editor after Google provider is enabled.
-- Existing username + 4-digit login remains unchanged.

alter table public.customers
  add column if not exists email text,
  add column if not exists auth_user_id uuid;

create unique index if not exists customers_auth_user_id_uidx
  on public.customers(auth_user_id)
  where auth_user_id is not null;

create index if not exists customers_email_lower_idx
  on public.customers (lower(email))
  where email is not null;

create or replace function public.bt_customer_google_login()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_auth_id uuid := auth.uid();
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_email_verified boolean := coalesce((auth.jwt() ->> 'email_verified')::boolean, false);
  v_name text;
  v_customer_id uuid;
  v_customer_name text;
  v_token uuid := gen_random_uuid();
  v_locked boolean := false;
  v_is_locked boolean := false;
  v_expires_at timestamptz;
  v_access_expiry timestamptz;
begin
  if v_auth_id is null then
    raise exception 'Google sign-in session is missing.';
  end if;
  if v_email = '' or not v_email_verified then
    raise exception 'Google must provide a verified email address.';
  end if;

  select c.id, c.name
    into v_customer_id, v_customer_name
  from public.customers c
  where c.auth_user_id = v_auth_id
  limit 1;

  if v_customer_id is null then
    select c.id, c.name
      into v_customer_id, v_customer_name
    from public.customers c
    where lower(trim(coalesce(c.email, ''))) = v_email
    order by c.created_at
    limit 1
    for update;

    if v_customer_id is not null then
      update public.customers
      set auth_user_id = v_auth_id
      where id = v_customer_id
        and (auth_user_id is null or auth_user_id = v_auth_id);
      if not found then
        raise exception 'This customer account is already linked to another Google account.';
      end if;
    else
      v_name := nullif(trim(coalesce(
        auth.jwt() -> 'user_metadata' ->> 'full_name',
        auth.jwt() -> 'user_metadata' ->> 'name',
        split_part(v_email, '@', 1)
      )), '');
      if v_name is null then
        v_name := 'Google Member';
      end if;
      if exists (select 1 from public.customers where lower(name) = lower(v_name)) then
        v_name := left(v_name, 28) || '-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
      end if;

      insert into public.customers(name, code_hash, email, auth_user_id)
      values (v_name, crypt(gen_random_uuid()::text, gen_salt('bf')), v_email, v_auth_id)
      returning id, name into v_customer_id, v_customer_name;
    end if;
  else
    update public.customers
      set email = coalesce(nullif(email, ''), v_email)
    where id = v_customer_id;
  end if;

  select coalesce(a.is_locked, false),
         a.expires_at
    into v_is_locked, v_access_expiry
  from public.bt_customer_access a
  where a.customer_id = v_customer_id;

  v_locked := coalesce(v_is_locked, false)
    or (v_access_expiry is not null and v_access_expiry <= now());

  insert into public.customer_sessions(token, customer_id, created_at, expires_at)
  values (v_token, v_customer_id, now(), now() + interval '30 days');

  if v_locked then
    return jsonb_build_object(
      'id', v_customer_id,
      'name', v_customer_name,
      'locked', true,
      'subscription_token', v_token
    );
  end if;

  return jsonb_build_object(
    'id', v_customer_id,
    'name', v_customer_name,
    'token', v_token,
    'locked', false
  );
end;
$$;

revoke all on function public.bt_customer_google_login() from public;
grant execute on function public.bt_customer_google_login() to authenticated;
