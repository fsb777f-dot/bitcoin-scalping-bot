-- Run once in the Supabase SQL editor before GPT paper trading starts.
-- Dedicated storage: no impact on existing main, AI, backtest, or Test journals.
create table if not exists public.btc_gpt_state (
  id integer primary key default 1 check (id = 1),
  candle_time bigint,
  side text not null default 'WAIT' check (side in ('BUY','SELL','WAIT')),
  rsi double precision,
  stoch_k double precision,
  stoch_d double precision,
  price numeric,
  updated_at timestamptz not null default now()
);
create table if not exists public.btc_gpt_trades (
  id bigint generated always as identity primary key,
  trade_key text not null unique,
  candle_time bigint not null,
  side text not null check (side in ('BUY','SELL')),
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  entry numeric not null,
  initial_sl numeric not null,
  sl numeric not null,
  tp numeric not null,
  exit_price numeric,
  pnl numeric,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists btc_gpt_trades_status_idx on public.btc_gpt_trades(status);
create index if not exists btc_gpt_trades_opened_idx on public.btc_gpt_trades(opened_at desc);
alter table public.btc_gpt_trades enable row level security;
alter table public.btc_gpt_state enable row level security;
-- No anon policies: ONLY the server-side service-role key may read/write these rows.
