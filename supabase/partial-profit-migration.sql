-- Run once in the Bitcoin Scalping Bot Supabase SQL Editor.
-- Preserves all existing Main and AI trade records; TEST tables are untouched.
alter table public.trades
  add column if not exists partial_exit_price numeric;
