-- Run this entire file once in the Supabase SQL Editor.
-- It is safe to run again after a partial setup.
create extension if not exists pgcrypto;

do $$ begin
  create type public.user_role as enum ('admin', 'member');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default 'Member',
  role public.user_role not null default 'member',
  created_at timestamptz not null default now()
);
create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, amount numeric(12,2) not null check (amount > 0), date date not null,
  due_date date, category text not null default 'Other', person text not null default '', note text not null default '',
  status text not null check (status in ('spent', 'lent', 'repaid')), created_at timestamptz not null default now()
);
alter table public.entries add column if not exists due_date date;
create table if not exists public.people (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, email text not null default '', phone text not null default '', created_at timestamptz not null default now(),
  unique (user_id, name)
);
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, target_amount numeric(12,2) not null check (target_amount > 0), saved_amount numeric(12,2) not null default 0,
  deadline date, color text not null default 'olive', created_at timestamptz not null default now()
);
create table if not exists public.notification_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  discord_webhook_url text not null default '', reminders_enabled boolean not null default true,
  reminder_days_before integer not null default 1 check (reminder_days_before >= 0), updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.entries enable row level security;
alter table public.people enable row level security;
alter table public.goals enable row level security;
alter table public.notification_settings enable row level security;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'); $$;

drop policy if exists "Users can read their profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can read their profile" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "Users can update own profile" on public.profiles for update using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
drop policy if exists "Users read own entries" on public.entries;
drop policy if exists "Users create own entries" on public.entries;
drop policy if exists "Users update own entries" on public.entries;
drop policy if exists "Users delete own entries" on public.entries;
create policy "Users read own entries" on public.entries for select using (user_id = auth.uid() or public.is_admin());
create policy "Users create own entries" on public.entries for insert with check (user_id = auth.uid());
create policy "Users update own entries" on public.entries for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
create policy "Users delete own entries" on public.entries for delete using (user_id = auth.uid() or public.is_admin());
drop policy if exists "Users read own people" on public.people;
drop policy if exists "Users create own people" on public.people;
drop policy if exists "Users update own people" on public.people;
create policy "Users read own people" on public.people for select using (user_id = auth.uid() or public.is_admin());
create policy "Users create own people" on public.people for insert with check (user_id = auth.uid());
create policy "Users update own people" on public.people for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
drop policy if exists "Users read own goals" on public.goals;
drop policy if exists "Users create own goals" on public.goals;
drop policy if exists "Users update own goals" on public.goals;
drop policy if exists "Users delete own goals" on public.goals;
create policy "Users read own goals" on public.goals for select using (user_id = auth.uid() or public.is_admin());
create policy "Users create own goals" on public.goals for insert with check (user_id = auth.uid());
create policy "Users update own goals" on public.goals for update using (user_id = auth.uid() or public.is_admin());
create policy "Users delete own goals" on public.goals for delete using (user_id = auth.uid() or public.is_admin());
drop policy if exists "Users read own notification settings" on public.notification_settings;
drop policy if exists "Users create own notification settings" on public.notification_settings;
drop policy if exists "Users update own notification settings" on public.notification_settings;
create policy "Users read own notification settings" on public.notification_settings for select using (user_id = auth.uid());
create policy "Users create own notification settings" on public.notification_settings for insert with check (user_id = auth.uid());
create policy "Users update own notification settings" on public.notification_settings for update using (user_id = auth.uid());

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public
as $$ begin insert into public.profiles (id, email, full_name) values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', 'Member')) on conflict (id) do update set email = excluded.email; return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
insert into public.profiles (id, email, full_name)
select id, email, coalesce(raw_user_meta_data->>'full_name', 'Member') from auth.users
on conflict (id) do update set email = excluded.email;

notify pgrst, 'reload schema';

-- After creating your account, promote it once:
-- update public.profiles set role = 'admin' where email = 'you@example.com';