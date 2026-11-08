-- Bitcoin Scalping Bot: shared virtual-trade journal
create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  trade_key text not null,
  trade_time bigint not null,
  side text not null check (side in ('BUY','SELL')),
  entry numeric not null,
  sl numeric not null,
  tp numeric not null,
  initial_tp numeric,
  trailing_distance numeric,
  trailing_active boolean not null default false,
  confirmations text[] not null default '{}',
  exit numeric,
  pnl numeric,
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  result text,
  updated_at timestamptz not null default now(),
  unique (user_id, trade_key)
);

alter table public.trades enable row level security;

drop policy if exists "Users can read their own trades" on public.trades;
create policy "Users can read their own trades"
  on public.trades for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own trades" on public.trades;
create policy "Users can insert their own trades"
  on public.trades for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own trades" on public.trades;
create policy "Users can update their own trades"
  on public.trades for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own trades" on public.trades;
create policy "Users can delete their own trades"
  on public.trades for delete to authenticated
  using (auth.uid() = user_id);

create index if not exists trades_user_time_idx
  on public.trades (user_id, trade_time desc);
