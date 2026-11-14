-- Meat Production: private per-user production worksheets
-- Run in Supabase Dashboard > SQL Editor for project tvaqcbzmzpyltbbelwbw.
-- This SQL does not grant anonymous access.
create extension if not exists pgcrypto;

create table if not exists public.production_papers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  paper_date date not null,
  plant text not null default '',
  staff_name text not null default '',
  portions jsonb not null,
  created_at timestamptz not null default now(),
  constraint portions_array check (
    jsonb_typeof(portions) = 'array'
    and jsonb_array_length(portions) between 1 and 1000
  )
);

create index if not exists production_papers_user_created_idx
  on public.production_papers(user_id,created_at desc);

alter table public.production_papers enable row level security;

-- Idempotent policies so the setup can be rerun.
drop policy if exists production_papers_select_own on public.production_papers;
drop policy if exists production_papers_insert_own on public.production_papers;
drop policy if exists production_papers_delete_own on public.production_papers;
drop policy if exists production_papers_update_own on public.production_papers;

create policy production_papers_select_own on public.production_papers
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy production_papers_insert_own on public.production_papers
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy production_papers_update_own on public.production_papers
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy production_papers_delete_own on public.production_papers
  for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.production_papers from public, anon;
grant select, insert, update, delete on public.production_papers to authenticated;

comment on table public.production_papers is 'Meat Production user-owned production worksheets. No public/anonymous access.';
