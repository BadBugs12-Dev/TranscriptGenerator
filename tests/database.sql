-- Run via a privileged SQL session against the existing schema. Every fixture rolls back.
begin;
do $$
declare
  test_user uuid := gen_random_uuid();
  other_user uuid := gen_random_uuid();
  outcome jsonb;
  day_count integer;
begin
  insert into auth.users(id) values(test_user),(other_user);
  if not exists(select 1 from public.profiles where user_id=test_user) then raise exception 'Signup profile trigger failed'; end if;
  for attempt in 1..3 loop
    outcome := public.record_transcript_success(test_user,'jNQXAC9IVRw');
    if not (outcome->>'allowed')::boolean then raise exception 'Allowed request rejected'; end if;
  end loop;
  outcome := public.record_transcript_success(test_user,'jNQXAC9IVRw');
  if (outcome->>'allowed')::boolean then raise exception 'Daily quota bypass'; end if;
  update public.transcript_usage set created_at=date_trunc('month',now()) - interval '1 day' where user_id=test_user;
  -- Fifteen successes in this month, but earlier than today, isolate the monthly check.
  -- On the first UTC day of a month there is no earlier day; daily limit still correctly denies.
  insert into public.transcript_usage(user_id,video_id,created_at)
    select test_user,'jNQXAC9IVRw',date_trunc('month',now()) from generate_series(1,15);
  outcome := public.record_transcript_success(test_user,'jNQXAC9IVRw');
  if (outcome->>'allowed')::boolean then raise exception 'Monthly quota bypass'; end if;
  update public.profiles set pro_expires_at=now()+interval '1 day' where user_id=test_user;
  select count(*) into day_count from public.transcript_usage where user_id=test_user;
  outcome := public.record_transcript_success(test_user,'jNQXAC9IVRw');
  if not (outcome->>'allowed')::boolean or not (outcome->>'is_pro')::boolean then raise exception 'Pro incorrectly limited'; end if;
  if day_count<>(select count(*) from public.transcript_usage where user_id=test_user) then raise exception 'Pro counted as Free'; end if;
  update public.profiles set pro_expires_at=now()-interval '1 second' where user_id=test_user;
  outcome := public.record_transcript_success(test_user,'jNQXAC9IVRw');
  if (outcome->>'allowed')::boolean then raise exception 'Expired Pro bypass'; end if;
  if has_function_privilege('authenticated','public.record_transcript_success(uuid,text)','EXECUTE') or has_function_privilege('anon','public.record_transcript_success(uuid,text)','EXECUTE') then raise exception 'Browser can invoke usage RPC'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',test_user,'role','authenticated')::text,true);
  set local role authenticated;
  if (select count(*) from public.profiles)<>1 then raise exception 'RLS cross-user profile leak'; end if;
  if exists(select 1 from public.transcript_usage where user_id<>test_user) then raise exception 'RLS cross-user usage leak'; end if;
  begin
    update public.profiles set pro_expires_at=now()+interval '10 years' where user_id=test_user;
    if found then raise exception 'User can grant own Pro'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.payments(user_id,payment_id,amount,status,purchased_at) values(test_user,'fake',0,'paid',now());
    raise exception 'User can fabricate payment';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;
rollback;
