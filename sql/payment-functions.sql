-- Additive payment reconciliation state; existing tables and read-only RLS remain.
alter table public.profiles add column if not exists gumroad_verified_at timestamptz;
alter table public.profiles add column if not exists gumroad_access_ends_at timestamptz;
alter table public.payments add column if not exists gumroad_subscription_id text;
alter table public.payments add column if not exists gumroad_verified_at timestamptz;
create index if not exists payments_gumroad_subscription_id_idx
  on public.payments (gumroad_subscription_id) where gumroad_subscription_id is not null;

-- Called only by the server after fetching the sale/subscriber from Gumroad.
-- A row lock serializes concurrent renewals, refunds and subscription updates.
create or replace function public.apply_verified_gumroad_event(
  p_user_id uuid,
  p_subscription_id text,
  p_verified_at timestamptz,
  p_access_ends_at timestamptz,
  p_payment jsonb default null
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  profile_row public.profiles%rowtype;
  existing_payment public.payments%rowtype;
  previous_ledger_end timestamptz;
  next_ledger_end timestamptz;
  manual_end timestamptz;
  latest_purchase timestamptz;
  current_subscription text;
  current_access_end timestamptz;
  current_verified_at timestamptz;
  purchased_at_value timestamptz;
  payment_end_value timestamptz;
begin
  if p_user_id is null or coalesce(length(p_subscription_id), 0) = 0 or p_verified_at is null then
    raise exception 'Invalid verified Gumroad event';
  end if;
  select * into profile_row from public.profiles where user_id = p_user_id for update;
  if not found then raise exception 'Linked profile not found'; end if;

  current_subscription := profile_row.gumroad_subscription_id;
  current_access_end := profile_row.gumroad_access_ends_at;
  current_verified_at := profile_row.gumroad_verified_at;

  select max(least(period_end, current_access_end)) into previous_ledger_end
    from public.payments where user_id = p_user_id and payment_provider = 'gumroad'
      and status in ('paid', 'trial')
      and (gumroad_subscription_id = current_subscription or gumroad_subscription_id is null);
  -- Preserve an administrator's independently extended entitlement. When the
  -- profile follows the payment ledger exactly, refunds/end events can reduce it.
  if profile_row.pro_expires_at is not null and
    (previous_ledger_end is null or profile_row.pro_expires_at > previous_ledger_end) then
    manual_end := profile_row.pro_expires_at;
  end if;

  if p_payment is not null then
    purchased_at_value := (p_payment->>'purchased_at')::timestamptz;
    payment_end_value := (p_payment->>'period_end')::timestamptz;
    if coalesce(length(p_payment->>'payment_id'), 0) = 0
      or coalesce(p_payment->>'status', '') not in ('paid','trial','refunded','disputed','chargeback','revoked')
      or purchased_at_value is null or payment_end_value is null or payment_end_value <= purchased_at_value
      or (p_payment->>'amount')::numeric < 0 or (p_payment->>'amount') is null
      or coalesce(p_payment->>'currency', '') !~ '^[A-Z]{3}$' then
      raise exception 'Invalid verified Gumroad payment';
    end if;
    select * into existing_payment from public.payments where payment_id = p_payment->>'payment_id';
    if found and (existing_payment.user_id <> p_user_id or existing_payment.payment_provider <> 'gumroad'
      or (existing_payment.gumroad_subscription_id is not null and existing_payment.gumroad_subscription_id <> p_subscription_id)) then
      raise exception 'Payment account linkage conflict';
    end if;
    -- A replay of an older subscription cannot overwrite a newer purchase link.
    select max(purchased_at) into latest_purchase from public.payments
      where user_id = p_user_id and payment_provider = 'gumroad';
    if current_subscription is null or
      (current_subscription <> p_subscription_id and purchased_at_value > coalesce(latest_purchase, '-infinity'::timestamptz)) then
      current_subscription := p_subscription_id;
      current_verified_at := null;
      current_access_end := null;
    end if;

    insert into public.payments (
      user_id, payment_provider, payment_id, amount, currency, status,
      purchased_at, period_start, period_end, gumroad_subscription_id, gumroad_verified_at
    ) values (
      p_user_id, 'gumroad', p_payment->>'payment_id', (p_payment->>'amount')::numeric,
      p_payment->>'currency', p_payment->>'status', purchased_at_value,
      purchased_at_value, payment_end_value, p_subscription_id, p_verified_at
    ) on conflict (payment_id) do update set
      amount = excluded.amount, currency = excluded.currency, status = excluded.status,
      purchased_at = excluded.purchased_at, period_start = excluded.period_start,
      period_end = excluded.period_end, gumroad_subscription_id = excluded.gumroad_subscription_id,
      gumroad_verified_at = excluded.gumroad_verified_at
    where public.payments.user_id = p_user_id and public.payments.payment_provider = 'gumroad'
      and (public.payments.gumroad_verified_at is null or public.payments.gumroad_verified_at <= excluded.gumroad_verified_at);
  end if;

  if current_subscription = p_subscription_id and
    (current_verified_at is null or current_verified_at <= p_verified_at) then
    current_verified_at := p_verified_at;
    current_access_end := p_access_ends_at;
  end if;

  select max(least(period_end, current_access_end)) into next_ledger_end
    from public.payments where user_id = p_user_id and payment_provider = 'gumroad'
      and status in ('paid', 'trial')
      and (gumroad_subscription_id = current_subscription or gumroad_subscription_id is null);
  update public.profiles set
    pro_expires_at = greatest(manual_end, next_ledger_end),
    gumroad_subscription_id = current_subscription,
    gumroad_verified_at = current_verified_at,
    gumroad_access_ends_at = current_access_end
    where user_id = p_user_id;
end;
$$;

revoke all on function public.apply_verified_gumroad_event(uuid,text,timestamptz,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.apply_verified_gumroad_event(uuid,text,timestamptz,timestamptz,jsonb) to service_role;
