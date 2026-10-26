-- Run in Supabase SQL Editor as project owner.
create table if not exists public.email_logs (
  id bigint generated always as identity primary key,
  recipient text not null,
  subject text not null,
  status text not null check (status in ('sent','failed','queued')),
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now()
);
create index if not exists email_logs_created_at_idx on public.email_logs(created_at desc);
create index if not exists email_logs_status_created_idx on public.email_logs(status,created_at);

-- Private quota ledger. The service-role API key is server-side only.
create table if not exists public.email_quota_reservations (
  id bigint generated always as identity primary key,
  day_utc date not null default (now() at time zone 'utc')::date,
  reserved_count integer not null check (reserved_count > 0),
  created_at timestamptz not null default now()
);
create index if not exists email_quota_day_idx on public.email_quota_reservations(day_utc);

alter table public.email_logs enable row level security;
alter table public.email_quota_reservations enable row level security;
-- No anon/authenticated policies are intentionally created. Browser clients cannot read/write logs or quotas.

create or replace function public.reserve_email_quota(
  requested_count integer,
  app_daily_limit integer,
  provider_daily_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  today_utc date := (now() at time zone 'utc')::date;
  used_count integer;
  effective_limit integer;
begin
  if requested_count is null or requested_count < 1 or requested_count > 50 then
    return jsonb_build_object('allowed',false,'reason','Request must contain 1–50 recipients.');
  end if;
  if app_daily_limit < 1 or provider_daily_limit < 1 then
    return jsonb_build_object('allowed',false,'reason','Daily limit configuration is invalid.');
  end if;
  -- Serializes all quota reservations to prevent concurrent requests exceeding the limit.
  perform pg_advisory_xact_lock(871209331);
  select coalesce(sum(reserved_count),0)::integer into used_count
  from public.email_quota_reservations where day_utc=today_utc;
  effective_limit := least(app_daily_limit,provider_daily_limit);
  if used_count + requested_count > effective_limit then
    return jsonb_build_object('allowed',false,'reason',format('Daily quota reached: %s of %s reserved. Provider and app limits both apply.',used_count,effective_limit));
  end if;
  insert into public.email_quota_reservations(day_utc,reserved_count) values(today_utc,requested_count);
  return jsonb_build_object('allowed',true,'reserved',requested_count,'used_before',used_count,'limit',effective_limit);
end;
$$;
revoke all on function public.reserve_email_quota(integer,integer,integer) from public, anon, authenticated;
grant execute on function public.reserve_email_quota(integer,integer,integer) to service_role;
grant select,insert on public.email_logs to service_role;
grant select,insert on public.email_quota_reservations to service_role;


-- Durable scheduled-send queue. Jobs are individual recipient sends.
create table if not exists public.email_jobs (
  id bigint generated always as identity primary key,
  recipient text not null,
  from_name text not null,
  from_email text not null,
  reply_to text,
  subject text not null,
  body_text text not null,
  scheduled_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued','processing','sent','failed')),
  attempts integer not null default 0,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists email_jobs_due_idx on public.email_jobs(status,scheduled_at);
alter table public.email_jobs enable row level security;
grant select,insert,update on public.email_jobs to service_role;
