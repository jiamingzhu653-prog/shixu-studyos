-- 时序 StudyOS · Supabase 免费云端账户同步建表脚本（0 成本方案）
-- 在 Supabase SQL Editor 中完整粘贴并点击 Run 即可启用跨设备统一账户云同步。

create table if not exists public.shixu_accounts (
  account text primary key,
  user_id text not null unique,
  name text not null,
  avatar text not null,
  color text not null,
  password_hash text not null,
  streak integer not null default 0,
  focus_minutes_today integer not null default 0,
  last_rollover_date text not null,
  payload jsonb not null default '{"categories":[],"exams":[],"tasks":[]}'::jsonb,
  updated_at bigint not null
);

create table if not exists public.shixu_groups (
  id text primary key,
  invite_code text not null unique,
  name text not null,
  exam_name text not null,
  target_date text not null,
  notice text not null,
  owner_id text not null,
  member_ids jsonb not null default '[]'::jsonb,
  member_snapshots jsonb not null default '{}'::jsonb,
  feeds jsonb not null default '[]'::jsonb,
  updated_at bigint not null
);

-- 开启基础访问权限（演示及轻量团队模式；正式商业化阶段可进一步切换为 Supabase Auth + RLS）
alter table public.shixu_accounts enable row level security;
alter table public.shixu_groups enable row level security;

drop policy if exists "shixu_accounts_rw" on public.shixu_accounts;
create policy "shixu_accounts_rw" on public.shixu_accounts
  for all using (true) with check (true);

drop policy if exists "shixu_groups_rw" on public.shixu_groups;
create policy "shixu_groups_rw" on public.shixu_groups
  for all using (true) with check (true);
