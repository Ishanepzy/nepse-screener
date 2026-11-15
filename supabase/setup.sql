-- NEPSE Screener: accounts, who may use the site, and where signed-in users' data lives. Run in Supabase: SQL Editor
-- -> New query -> paste -> Run. Running it again is harmless: it changes nobody's access and keeps everyone's data.
--
-- The site holds only the publishable key, so everything below is what decides who sees what.

-- ---------- who may use the site ----------
-- Every new account starts out 'pending'. An admin approves or blocks it on the site's Users page. Only approved
-- accounts get past the sign-in screen, and only they can read or save their data (the user_data policies check it).
--
-- After the first run, make your own account the admin (once, with your address):
--   update public.members set status = 'approved', is_admin = true
--   where user_id = (select id from auth.users where email = 'you@example.com');

create table if not exists public.members (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  status     text        not null default 'pending' check (status in ('pending', 'approved', 'blocked')),
  is_admin   boolean     not null default false,
  decided_at timestamptz,
  decided_by uuid        references auth.users (id) on delete set null
);

-- RLS on with no policies: the site can't read or change this table directly, only through the functions below
alter table public.members enable row level security;
revoke all on public.members from anon, authenticated;

-- a new account joins the waiting list
create or replace function public.add_member() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.members (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end
$$;

drop trigger if exists nepse_add_member on auth.users;
create trigger nepse_add_member after insert on auth.users
  for each row execute function public.add_member();

-- accounts made before this existed wait too, the admin's included, until the update above
insert into public.members (user_id) select id from auth.users on conflict (user_id) do nothing;

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.members where user_id = auth.uid() and status = 'approved');
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.members where user_id = auth.uid() and status = 'approved' and is_admin);
$$;

-- the signed-in user's own standing, for the sign-in screen
create or replace function public.my_access() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('status', status, 'admin', is_admin and status = 'approved') from public.members where user_id = auth.uid()),
    jsonb_build_object('status', 'pending', 'admin', false)
  );
$$;

-- admins: everyone with an account, newest first
create or replace function public.list_members()
returns table (user_id uuid, email text, status text, is_admin boolean, signed_up timestamptz, confirmed timestamptz, last_sign_in timestamptz, decided_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Only an admin can see the accounts' using errcode = '42501';
  end if;
  return query
    select m.user_id, u.email::text, m.status, m.is_admin, u.created_at, u.email_confirmed_at, u.last_sign_in_at, m.decided_at
    from public.members m
    join auth.users u on u.id = m.user_id
    order by u.created_at desc;
end
$$;

-- admins: approve, block, or put back on the waiting list. Not yourself, and not another admin: admins are changed
-- here in the SQL editor, so one admin account in the wrong hands can't lock the others out.
create or replace function public.set_member_status(target uuid, new_status text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change who has access' using errcode = '42501';
  end if;
  if new_status is null or new_status not in ('pending', 'approved', 'blocked') then
    raise exception 'Unknown status: %', new_status using errcode = '22023';
  end if;
  if target = auth.uid() then
    raise exception 'You can''t change your own access' using errcode = '42501';
  end if;
  if exists (select 1 from public.members where user_id = target and is_admin) then
    raise exception 'Admins are changed in the SQL editor, not here' using errcode = '42501';
  end if;
  update public.members set status = new_status, decided_at = now(), decided_by = auth.uid() where user_id = target;
  if not found then
    raise exception 'No such account' using errcode = 'P0002';
  end if;
end
$$;

-- Supabase lets every role call new functions by default; signed-out visitors get none of these
revoke execute on function public.add_member() from public, anon, authenticated;
revoke execute on function public.is_approved(), public.is_admin(), public.my_access(), public.list_members(), public.set_member_status(uuid, text) from public, anon;
grant execute on function public.is_approved(), public.is_admin(), public.my_access(), public.list_members(), public.set_member_status(uuid, text) to authenticated;

-- ---------- the user's data ----------
-- One row per saved item and user, under the same names the site uses in the browser (nepse.watchlist.v1,
-- nepse.journal.v1, nepse.drawings.v2, ...). Each user reaches only their own rows, and only once approved.

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
  for select to authenticated using ((select auth.uid()) = user_id and (select public.is_approved()));
create policy "add own data" on public.user_data
  for insert to authenticated with check ((select auth.uid()) = user_id and (select public.is_approved()));
create policy "change own data" on public.user_data
  for update to authenticated
  using ((select auth.uid()) = user_id and (select public.is_approved()))
  with check ((select auth.uid()) = user_id and (select public.is_approved()));
create policy "delete own data" on public.user_data
  for delete to authenticated using ((select auth.uid()) = user_id and (select public.is_approved()));

-- signed-in users reach the table through the Data API; signed-out visitors don't
revoke all on public.user_data from anon;
grant select, insert, update, delete on public.user_data to authenticated;
