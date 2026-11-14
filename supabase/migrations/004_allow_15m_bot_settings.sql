-- Allow 15-minute BTC scans after applying a backtest preset.
-- Run once in the Supabase SQL Editor for the Bitcoin Scalping Bot project.
-- No existing settings, trades, positions, or journal rows are changed.
BEGIN;
ALTER TABLE public.bot_settings
  DROP CONSTRAINT IF EXISTS bot_settings_timeframe_check;
ALTER TABLE public.bot_settings
  ADD CONSTRAINT bot_settings_timeframe_check
    CHECK (timeframe IN ('1m', '5m', '15m'));
COMMIT;
