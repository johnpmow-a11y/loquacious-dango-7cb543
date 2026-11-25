-- Per-customer, one-time admin-post delivery queue. Admin archive and 24-hour Status stories are separate.
create table if not exists public.aam_social_admin_post_deliveries (
  customer_id uuid not null references public.customers(id) on delete cascade,
  post_id uuid not null references public.aam_social_posts(id) on delete cascade,
  scheduled_at timestamptz not null,
  delivered_at timestamptz,
  skipped_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (customer_id, post_id)
);
create index if not exists aam_social_admin_post_deliveries_due_idx
  on public.aam_social_admin_post_deliveries(customer_id, scheduled_at)
  where delivered_at is null and skipped_at is null;
alter table public.aam_social_admin_post_deliveries enable row level security;
revoke all on public.aam_social_admin_post_deliveries from anon, authenticated;
grant all on public.aam_social_admin_post_deliveries to service_role;

create or replace function public.aam_social_next_admin_post(p_token uuid)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare
  v_customer uuid;
  v_next timestamptz;
  v_post uuid;
  v_delivered timestamptz;
begin
  select customer_id into v_customer from public.customer_sessions
   where token=p_token and expires_at>now() limit 1;
  if v_customer is null then raise exception 'Session expired'; end if;
  if not exists(select 1 from public.aam_social_profiles where customer_id=v_customer and adult_confirmed_at is not null) then
    raise exception 'Confirm that you are 18 or older to continue.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_customer::text, 0));
  select greatest(now(), coalesce(max(scheduled_at)+interval '50 minutes', now()))
    into v_next from public.aam_social_admin_post_deliveries where customer_id=v_customer;
  with missing as (
    select p.id, p.created_at,
           row_number() over(order by p.created_at asc, p.id asc) as rn
      from public.aam_social_posts p
     where p.author_role='admin' and p.moderation_status='published'
       and not exists(select 1 from public.aam_social_admin_post_deliveries d
                       where d.customer_id=v_customer and d.post_id=p.id)
  )
  insert into public.aam_social_admin_post_deliveries(customer_id,post_id,scheduled_at)
  select v_customer,id,v_next+(rn-1)*interval '50 minutes' from missing
  on conflict(customer_id,post_id) do nothing;

  select d.post_id into v_post
    from public.aam_social_admin_post_deliveries d
    join public.aam_social_posts p on p.id=d.post_id
   where d.customer_id=v_customer and d.delivered_at is null and d.skipped_at is null
     and d.scheduled_at<=now() and p.author_role='admin' and p.moderation_status='published'
   order by d.scheduled_at asc limit 1 for update of d;
  if v_post is not null then
    v_delivered := clock_timestamp();
    update public.aam_social_admin_post_deliveries
       set delivered_at=v_delivered
     where customer_id=v_customer and post_id=v_post and delivered_at is null and skipped_at is null;
    -- If the customer returns late, push every remaining item forward so deliveries
    -- still have a full 50-minute gap from the actual delivery time.
    with pending as (
      select customer_id,post_id,row_number() over(order by scheduled_at,created_at,post_id) as rn
        from public.aam_social_admin_post_deliveries
       where customer_id=v_customer and delivered_at is null and skipped_at is null
    )
    update public.aam_social_admin_post_deliveries d
       set scheduled_at=greatest(d.scheduled_at,v_delivered+pending.rn*interval '50 minutes')
      from pending
     where d.customer_id=pending.customer_id and d.post_id=pending.post_id;
  end if;
  return v_post;
end;
$$;

create or replace function public.aam_social_skip_admin_post(p_token uuid,p_post_id uuid)
returns boolean
language plpgsql security definer set search_path=public
as $$
declare v_customer uuid; v_skipped boolean := false;
begin
  select customer_id into v_customer from public.customer_sessions
   where token=p_token and expires_at>now() limit 1;
  if v_customer is null then raise exception 'Session expired'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_customer::text, 0));
  update public.aam_social_admin_post_deliveries
     set skipped_at=clock_timestamp()
   where customer_id=v_customer and post_id=p_post_id
     and delivered_at is not null and skipped_at is null;
  v_skipped := found;
  if v_skipped then
    -- Skipping advances the queue, but never removes the 50-minute delivery spacing.
    with pending as (
      select customer_id,post_id,row_number() over(order by scheduled_at,created_at,post_id) as rn
        from public.aam_social_admin_post_deliveries
       where customer_id=v_customer and delivered_at is null and skipped_at is null
    )
    update public.aam_social_admin_post_deliveries d
       set scheduled_at=greatest(d.scheduled_at,
         (select skipped_at from public.aam_social_admin_post_deliveries
           where customer_id=v_customer and post_id=p_post_id)+pending.rn*interval '50 minutes')
      from pending
     where d.customer_id=pending.customer_id and d.post_id=pending.post_id;
  end if;
  return v_skipped;
end;
$$;
revoke all on function public.aam_social_next_admin_post(uuid) from public, anon, authenticated;
revoke all on function public.aam_social_skip_admin_post(uuid,uuid) from public, anon, authenticated;
grant execute on function public.aam_social_next_admin_post(uuid) to service_role;
grant execute on function public.aam_social_skip_admin_post(uuid,uuid) to service_role;
