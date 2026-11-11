-- Capital.com DEMO accounting. These fields do not change virtual PnL.
-- Run once in the same Supabase project as 002_demo_execution.sql.
alter table public.trades
  add column if not exists demo_size numeric,
  add column if not exists demo_open_pnl numeric,
  add column if not exists demo_closed_at timestamptz,
  add column if not exists demo_pnl_source text;

create index if not exists trades_demo_recent_idx
  on public.trades (trade_time desc)
  where execution_mode in ('MAIN_DEMO', 'AI_DEMO');
