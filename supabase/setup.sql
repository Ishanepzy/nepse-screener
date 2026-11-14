-- NEPSE Screener: where signed-in users' data lives. Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Running it again is harmless.
--
-- One row per saved item and user, under the same names the site uses in the browser (nepse.watchlist.v1,
-- nepse.journal.v1, nepse.drawings.v2, ...). The site holds only the publishable key, so the policies below are what
-- keep each user to their own rows.

create table if not exists public.user_data (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  key        text        not null check (key ~ '^nepse\.[A-Za-z0-9._-]{1,80}$'),
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key),
  -- 2 MB per item: years of drawings and journal entries fit easily; anything bigger is a mistake or abuse
  constraint user_data_size check (pg_column_size(value) <= 2097152)
);

alter table public.user_data enable row level security;

drop policy if exists "read own data" on public.user_data;
drop policy if exists "add own data" on public.user_data;
drop policy if exists "change own data" on public.user_data;
drop policy if exists "delete own data" on public.user_data;

create policy "read own data" on public.user_data
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "add own data" on public.user_data
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "change own data" on public.user_data
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own data" on public.user_data
  for delete to authenticated using ((select auth.uid()) = user_id);

-- signed-in users reach the table through the Data API; signed-out visitors don't
revoke all on public.user_data from anon;
grant select, insert, update, delete on public.user_data to authenticated;
