-- Additive setup for the existing profiles/transcript_usage tables. Does not alter RLS.
-- Only the server's service_role can invoke this function; never grant it to browsers.
create index if not exists transcript_usage_user_created_idx
  on public.transcript_usage (user_id, created_at);

create or replace function public.record_transcript_success(p_user_id uuid, p_video_id text)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  expiry timestamptz;
  day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  month_start timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  today_count integer;
  month_count integer;
begin
  if p_video_id !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'Invalid video ID'; end if;
  -- Serializes quota decisions for one account across concurrent Vercel instances.
  select pro_expires_at into expiry from public.profiles where user_id=p_user_id for update;
  if not found then raise exception 'Profile not found'; end if;
  if expiry > now() then return jsonb_build_object('allowed',true,'is_pro',true); end if;
  select count(*) filter (where created_at >= day_start), count(*)
    into today_count,month_count from public.transcript_usage
    where user_id=p_user_id and created_at >= month_start;
  if today_count >= 3 or month_count >= 15 then
    return jsonb_build_object('allowed',false,'is_pro',false,'today',today_count,'month',month_count);
  end if;
  insert into public.transcript_usage(user_id,video_id) values(p_user_id,p_video_id);
  return jsonb_build_object('allowed',true,'is_pro',false,'today',today_count+1,'month',month_count+1);
end;
$$;
revoke all on function public.record_transcript_success(uuid,text) from public,anon,authenticated;
grant execute on function public.record_transcript_success(uuid,text) to service_role;
