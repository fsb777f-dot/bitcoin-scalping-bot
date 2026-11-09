-- Mutually exclusive execution mode and manual BTC size.
-- Safe defaults: existing and new sessions remain virtual until explicitly changed.
alter table public.bot_settings
  add column if not exists execution_mode text not null default 'VIRTUAL',
  add column if not exists trade_size numeric;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bot_settings_execution_mode_check'
      and conrelid = 'public.bot_settings'::regclass
  ) then
    alter table public.bot_settings
      add constraint bot_settings_execution_mode_check
      check (execution_mode in ('VIRTUAL', 'MAIN_DEMO', 'AI_DEMO'));
  end if;
end $$;

alter table public.trades
  add column if not exists execution_mode text not null default 'VIRTUAL',
  add column if not exists capital_deal_id text,
  add column if not exists capital_deal_reference text,
  add column if not exists capital_status text;

create index if not exists trades_capital_deal_idx
  on public.trades (capital_deal_id)
  where capital_deal_id is not null;
