-- Bitcoin Scalping Bot: shared settings and latest server scanner state.
-- Run this once in Supabase SQL Editor.
create table if not exists public.bot_settings (
  id integer primary key default 1 check (id = 1),
  timeframe text not null default '1m' check (timeframe in ('1m','5m','15m')),
  enabled_strategies jsonb not null default '[]'::jsonb,
  consensus_enabled boolean not null default true,
  required_matches integer not null default 3 check (required_matches between 1 and 41),
  risk_reward numeric not null default 2 check (risk_reward in (1,1.5,2,2.5,3,4)),
  ai_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.bot_settings add column if not exists ai_enabled boolean not null default false;

insert into public.bot_settings (id, timeframe, enabled_strategies, consensus_enabled, required_matches, risk_reward, ai_enabled)
values (1, '1m', '[]'::jsonb, true, 3, 2, false)
on conflict (id) do nothing;

create table if not exists public.bot_state (
  id integer primary key default 1 check (id = 1),
  timeframe text,
  price numeric,
  side text not null default 'WAIT',
  count integer not null default 0,
  active_count integer not null default 0,
  required_matches integer not null default 3,
  consensus_enabled boolean not null default true,
  entry numeric,
  sl numeric,
  tp numeric,
  candle_time bigint,
  strategy_results jsonb not null default '[]'::jsonb,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.bot_state add column if not exists ai_enabled boolean not null default false;
alter table public.bot_state add column if not exists ai_side text;
alter table public.bot_state add column if not exists ai_count integer not null default 0;
alter table public.bot_state add column if not exists ai_entry numeric;
alter table public.bot_state add column if not exists ai_sl numeric;
alter table public.bot_state add column if not exists ai_tp numeric;
alter table public.bot_state add column if not exists ai_confidence integer;
alter table public.bot_state add column if not exists ai_reason text;
alter table public.bot_state add column if not exists ai_selected jsonb not null default '[]'::jsonb;
alter table public.bot_state add column if not exists ai_excluded jsonb not null default '[]'::jsonb;
alter table public.bot_state add column if not exists ai_performance jsonb not null default '[]'::jsonb;
alter table public.bot_state add column if not exists normal_side text;
alter table public.bot_state add column if not exists market_source text;
alter table public.bot_state add column if not exists scan_ok boolean;
alter table public.bot_settings enable row level security;
alter table public.bot_state enable row level security;
drop policy if exists "Public can read bot settings" on public.bot_settings;
drop policy if exists "Public can write bot settings" on public.bot_settings;
drop policy if exists "Public can read bot state" on public.bot_state;
create policy "Public can read bot settings" on public.bot_settings for select to anon, authenticated using (true);
create policy "Public can write bot settings" on public.bot_settings for all to anon, authenticated using (true) with check (true);
create policy "Public can read bot state" on public.bot_state for select to anon, authenticated using (true);
grant select, insert, update, delete on public.bot_settings to anon, authenticated;
grant select on public.bot_state to anon, authenticated;
