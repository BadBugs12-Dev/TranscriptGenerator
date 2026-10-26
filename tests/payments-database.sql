-- Run as the database administrator after sql/payment-functions.sql.
-- All fixtures and profile/payment updates are rolled back.
begin;
do $$
declare
  paid_user uuid := gen_random_uuid();
  trial_user uuid := gen_random_uuid();
  manual_user uuid := gen_random_uuid();
  payment_json jsonb;
  result_end timestamptz;
  result_subscription text;
  result_status text;
  result_count integer;
begin
  if has_function_privilege('anon', 'public.apply_verified_gumroad_event(uuid,text,timestamptz,timestamptz,jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.apply_verified_gumroad_event(uuid,text,timestamptz,timestamptz,jsonb)', 'execute')
    or not has_function_privilege('service_role', 'public.apply_verified_gumroad_event(uuid,text,timestamptz,timestamptz,jsonb)', 'execute') then
    raise exception 'Payment RPC must be executable only by the service role';
  end if;

  insert into auth.users(id) values (paid_user), (trial_user), (manual_user);

  payment_json := jsonb_build_object('payment_id', 'fixture-' || paid_user || '-1', 'amount', 3.99,
    'currency', 'USD', 'status', 'paid', 'purchased_at', '2026-01-01T00:00:00Z',
    'period_end', '2026-02-01T00:00:00Z');
  perform public.apply_verified_gumroad_event(paid_user, 'fixture-sub-' || paid_user, '2026-01-01T00:00:00Z', null, payment_json);
  select pro_expires_at into result_end from public.profiles where user_id = paid_user;
  if result_end is distinct from '2026-02-01T00:00:00Z'::timestamptz then raise exception 'Initial payment did not grant its period'; end if;
  perform public.apply_verified_gumroad_event(paid_user, 'fixture-sub-' || paid_user, '2026-01-02T00:00:00Z', null, payment_json);
  select count(*) into result_count from public.payments where user_id = paid_user;
  if result_count <> 1 then raise exception 'Duplicate sale was not idempotent'; end if;
  begin
    perform public.apply_verified_gumroad_event(trial_user, 'fixture-sub-' || trial_user, '2026-01-02T00:00:00Z', null, payment_json);
    raise exception 'Expected payment ownership conflict';
  exception when raise_exception then
    if sqlerrm <> 'Payment account linkage conflict' then raise; end if;
  end;

  payment_json := payment_json || jsonb_build_object('payment_id', 'fixture-' || paid_user || '-2',
    'purchased_at', '2026-02-01T00:00:00Z', 'period_end', '2026-03-01T00:00:00Z');
  perform public.apply_verified_gumroad_event(paid_user, 'fixture-sub-' || paid_user, '2026-02-01T00:00:00Z', null, payment_json);
  select pro_expires_at into result_end from public.profiles where user_id = paid_user;
  if result_end is distinct from '2026-03-01T00:00:00Z'::timestamptz then raise exception 'Renewal did not extend access'; end if;

  -- Pending cancellation preserves the paid period until the effective boundary.
  perform public.apply_verified_gumroad_event(paid_user, 'fixture-sub-' || paid_user, '2026-02-10T00:00:00Z', '2026-03-01T00:00:00Z', null);
  select pro_expires_at into result_end from public.profiles where user_id = paid_user;
  if result_end is distinct from '2026-03-01T00:00:00Z'::timestamptz then raise exception 'Cancellation revoked paid time prematurely'; end if;

  perform public.apply_verified_gumroad_event(paid_user, 'fixture-sub-' || paid_user, '2026-02-20T00:00:00Z', '2026-02-20T00:00:00Z', null);
  select pro_expires_at into result_end from public.profiles where user_id = paid_user;
  if result_end is distinct from '2026-02-20T00:00:00Z'::timestamptz then raise exception 'Verified termination did not cap access'; end if;
  perform public.apply_verified_gumroad_event(paid_user, 'fixture-sub-' || paid_user, '2026-02-21T00:00:00Z', '2026-02-20T00:00:00Z', payment_json);
  select pro_expires_at into result_end from public.profiles where user_id = paid_user;
  if result_end is distinct from '2026-02-20T00:00:00Z'::timestamptz then raise exception 'Replayed sale restored terminated access'; end if;
  perform public.apply_verified_gumroad_event(paid_user, 'fixture-sub-' || paid_user, '2026-02-19T00:00:00Z', null, payment_json);
  select pro_expires_at into result_end from public.profiles where user_id = paid_user;
  if result_end is distinct from '2026-02-20T00:00:00Z'::timestamptz then raise exception 'Stale active snapshot overwrote termination'; end if;

  perform public.apply_verified_gumroad_event(paid_user, 'fixture-sub-' || paid_user, '2026-02-22T00:00:00Z', '2026-02-20T00:00:00Z', payment_json || '{"status":"refunded"}');
  select pro_expires_at into result_end from public.profiles where user_id = paid_user;
  if result_end is distinct from '2026-02-01T00:00:00Z'::timestamptz then raise exception 'Refund did not remove the refunded period'; end if;
  perform public.apply_verified_gumroad_event(paid_user, 'fixture-sub-' || paid_user, '2026-02-21T12:00:00Z', null, payment_json);
  select status into result_status from public.payments where payment_id = payment_json->>'payment_id';
  if result_status <> 'refunded' then raise exception 'Stale paid snapshot undid refund'; end if;
  select pro_expires_at into result_end from public.profiles where user_id = paid_user;
  if result_end is distinct from '2026-02-01T00:00:00Z'::timestamptz then raise exception 'Stale paid snapshot regranted refunded period'; end if;

  -- A newer real purchase may establish a new subscription. Old callbacks cannot
  -- replace the account's current subscription or its entitlement snapshot.
  payment_json := payment_json || jsonb_build_object('payment_id', 'fixture-' || paid_user || '-3',
    'purchased_at', '2026-03-01T00:00:00Z', 'period_end', '2026-04-01T00:00:00Z');
  perform public.apply_verified_gumroad_event(paid_user, 'fixture-new-sub-' || paid_user, '2026-03-01T00:00:00Z', null, payment_json);
  perform public.apply_verified_gumroad_event(paid_user, 'fixture-sub-' || paid_user, '2026-03-02T00:00:00Z', '2026-02-20T00:00:00Z', null);
  select pro_expires_at, gumroad_subscription_id into result_end, result_subscription from public.profiles where user_id = paid_user;
  if result_end is distinct from '2026-04-01T00:00:00Z'::timestamptz or result_subscription <> 'fixture-new-sub-' || paid_user then
    raise exception 'Old subscription event replaced newer membership';
  end if;

  payment_json := jsonb_build_object('payment_id', 'fixture-' || trial_user, 'amount', 0,
    'currency', 'USD', 'status', 'trial', 'purchased_at', '2026-01-01T00:00:00Z',
    'period_end', '2026-01-08T00:00:00Z');
  perform public.apply_verified_gumroad_event(trial_user, 'fixture-sub-' || trial_user, '2026-01-01T00:00:00Z', null, payment_json);
  select pro_expires_at into result_end from public.profiles where user_id = trial_user;
  if result_end is distinct from '2026-01-08T00:00:00Z'::timestamptz then raise exception 'Trial did not use actual seven-day end'; end if;

  payment_json := jsonb_build_object('payment_id', 'fixture-' || manual_user, 'amount', 3.99,
    'currency', 'USD', 'status', 'paid', 'purchased_at', '2026-01-01T00:00:00Z',
    'period_end', '2026-02-01T00:00:00Z');
  perform public.apply_verified_gumroad_event(manual_user, 'fixture-sub-' || manual_user, '2026-01-01T00:00:00Z', null, payment_json);
  update public.profiles set pro_expires_at = '2030-01-01T00:00:00Z' where user_id = manual_user;
  perform public.apply_verified_gumroad_event(manual_user, 'fixture-sub-' || manual_user, '2026-01-02T00:00:00Z', null, payment_json || '{"status":"refunded"}');
  perform public.apply_verified_gumroad_event(manual_user, 'fixture-sub-' || manual_user, '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z', null);
  select pro_expires_at into result_end from public.profiles where user_id = manual_user;
  if result_end is distinct from '2030-01-01T00:00:00Z'::timestamptz then raise exception 'Payment reconciliation overwrote manual extension'; end if;

  set local role authenticated;
  begin
    perform public.apply_verified_gumroad_event(manual_user, 'fixture-sub-' || manual_user, now(), null, null);
    raise exception 'Browser role invoked payment RPC';
  exception when insufficient_privilege then null;
  end;
  reset role;

  raise notice 'Payment database assertions passed; fixtures will be rolled back.';
end;
$$;
rollback;
