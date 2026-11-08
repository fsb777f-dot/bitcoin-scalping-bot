-- WARNING: This makes the virtual journal public to anyone with the app URL.
-- Run once in Supabase SQL Editor.
drop policy if exists "Users can read their own trades" on public.trades;
drop policy if exists "Users can insert their own trades" on public.trades;
drop policy if exists "Users can update their own trades" on public.trades;
drop policy if exists "Users can delete their own trades" on public.trades;
drop policy if exists "Public can read shared journal" on public.trades;
drop policy if exists "Public can insert shared journal" on public.trades;
drop policy if exists "Public can update shared journal" on public.trades;
drop policy if exists "Public can delete shared journal" on public.trades;

alter table public.trades drop constraint if exists trades_user_id_fkey;
alter table public.trades drop constraint if exists trades_user_id_trade_key_key;
alter table public.trades drop column if exists user_id;
alter table public.trades add constraint trades_trade_key_key unique (trade_key);

create policy "Public can read shared journal"
  on public.trades for select to anon, authenticated using (true);
create policy "Public can insert shared journal"
  on public.trades for insert to anon, authenticated with check (true);
create policy "Public can update shared journal"
  on public.trades for update to anon, authenticated using (true) with check (true);
create policy "Public can delete shared journal"
  on public.trades for delete to anon, authenticated using (true);

grant select, insert, update, delete on public.trades to anon, authenticated;
