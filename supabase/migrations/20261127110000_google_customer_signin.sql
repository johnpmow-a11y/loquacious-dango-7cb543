-- Google sign-in for existing All Ads Manager customer accounts.
-- Google identities are linked only to an account with the same verified registered email.
-- Existing username/four-digit login and administrator login are unchanged.
begin;

create table if not exists public.customer_google_identities (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  customer_id uuid not null unique references public.customers(id) on delete cascade,
  linked_at timestamptz not null default now()
);
alter table public.customer_google_identities enable row level security;
revoke all on public.customer_google_identities from public, anon, authenticated;

create or replace function public.bt_customer_google_login()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_email text;
  v_email_confirmed_at timestamptz;
  v_customer_id uuid;
  v_matches integer;
  v_customer public.customers;
  v_access public.bt_customer_access;
  v_token uuid;
  v_subscription_token uuid;
begin
  if v_auth_user_id is null then
    raise exception 'Sign in with Google first.';
  end if;

  select lower(trim(u.email)), u.email_confirmed_at
    into v_email, v_email_confirmed_at
  from auth.users u
  where u.id = v_auth_user_id;

  if v_email is null or v_email_confirmed_at is null then
    raise exception 'Google must provide a verified email address.';
  end if;

  select g.customer_id into v_customer_id
  from public.customer_google_identities g
  where g.auth_user_id = v_auth_user_id;

  if v_customer_id is null then
    select count(*) into v_matches
    from public.customers c
    join public.customer_contact_emails e
      on e.customer_id = c.id::text
    where lower(trim(e.email)) = v_email;

    if v_matches = 0 then
      raise exception 'No All Ads Manager account uses this Google email. First log in with your username and four-digit code, and make sure this same email is registered.';
    elsif v_matches > 1 then
      raise exception 'This email matches more than one account. Please contact All Ads Manager support.';
    end if;

    select c.id into v_customer_id
    from public.customers c
    join public.customer_contact_emails e
      on e.customer_id = c.id::text
    where lower(trim(e.email)) = v_email
    limit 1;

    begin
      insert into public.customer_google_identities(auth_user_id, customer_id)
      values (v_auth_user_id, v_customer_id);
    exception when unique_violation then
      select g.customer_id into v_customer_id
      from public.customer_google_identities g
      where g.auth_user_id = v_auth_user_id;
      if v_customer_id is null then
        raise exception 'This All Ads Manager account is already linked to another Google account.';
      end if;
    end;
  end if;

  select * into v_customer
  from public.customers c
  where c.id = v_customer_id;

  if v_customer.id is null then
    raise exception 'The linked All Ads Manager account could not be found.';
  end if;

  select * into v_access
  from public.bt_customer_access a
  where a.customer_id = v_customer_id;

  if coalesce(v_access.is_locked, false)
     or (v_access.subscription_expires_at is not null
         and v_access.subscription_expires_at <= now()) then
    insert into public.bt_subscription_sessions(customer_id)
    values (v_customer_id)
    returning token into v_subscription_token;

    return jsonb_build_object(
      'locked', true,
      'id', v_customer_id,
      'name', v_customer.name,
      'subscription_token', v_subscription_token,
      'email', v_email
    );
  end if;

  insert into public.customer_sessions(customer_id)
  values (v_customer_id)
  returning token into v_token;

  return jsonb_build_object(
    'locked', false,
    'id', v_customer_id,
    'name', v_customer.name,
    'token', v_token,
    'email', v_email
  );
end;
$function$;

revoke all on function public.bt_customer_google_login() from public, anon;
grant execute on function public.bt_customer_google_login() to authenticated;

commit;
