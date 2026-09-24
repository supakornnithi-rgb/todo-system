-- =============================================================================
-- L2P1_schema.sql — สร้างตาราง, trigger, สิทธิ์ (grants) และ RLS สำหรับ todo-system
-- วางทั้งไฟล์ใน SQL Editor แล้วกด Run
-- รันซ้ำได้ไม่พัง (idempotent) — ใช้ create if not exists / drop-then-create ทุกจุด
-- =============================================================================

-- สรุปภาพรวม (ภาษาไทย):
-- ตาราง 5 ตัว: tasks (งาน), subtasks (งานย่อย), projects (โปรเจกต์),
--   dreams (ความฝัน), line_index (ดัชนีเลขที่ LINE bot ใช้)
-- กติกาอัตโนมัติ 3 ข้อ (ทำงานผ่าน trigger):
--   1) ต่อท้ายวัน: เพิ่มงานใหม่ หรือย้ายวันของงาน จะได้ sort_order ต่อจาก
--      งานลำดับสุดท้ายของวันนั้นเสมอ (ถ้าไม่ได้ระบุ sort_order มาเอง)
--   2) completed_at: ติ๊กเสร็จ (done=true) จะประทับเวลาให้อัตโนมัติ
--      ติ๊กกลับ (done=false) จะล้างเวลาทิ้ง ใช้กับทั้ง tasks และ dreams
--   3) ติ๊กงานหลักอัตโนมัติ: เมื่องานย่อยครบทุกอันแล้ว งานหลักจะถูกติ๊กเสร็จให้
--      (ทางเดียว — ติ๊กงานย่อยกลับไม่ทำให้งานหลักย้อนกลับ)

begin;

-- -----------------------------------------------------------------------------
-- 1. ฟังก์ชัน trigger ที่ใช้ร่วมกัน
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    if new.done and new.completed_at is null then
      new.completed_at = now();
    elsif not new.done then
      new.completed_at = null;
    end if;
  elsif TG_OP = 'UPDATE' then
    if new.done and not old.done and new.completed_at is not distinct from old.completed_at then
      new.completed_at = now();
    elsif not new.done then
      new.completed_at = null;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.tasks_append_order()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.day is null then
    new.sort_order = null;
    return new;
  end if;

  if TG_OP = 'INSERT' then
    if new.sort_order is null then
      perform pg_advisory_xact_lock(hashtext(new.user_id::text || '|' || new.workspace || '|' || new.day::text));
      select coalesce(max(sort_order), 0) + 1 into new.sort_order
      from public.tasks
      where user_id = new.user_id
        and workspace = new.workspace
        and day = new.day
        and id <> new.id;
    end if;
  elsif TG_OP = 'UPDATE' then
    if new.day is distinct from old.day and new.sort_order is not distinct from old.sort_order then
      perform pg_advisory_xact_lock(hashtext(new.user_id::text || '|' || new.workspace || '|' || new.day::text));
      select coalesce(max(sort_order), 0) + 1 into new.sort_order
      from public.tasks
      where user_id = new.user_id
        and workspace = new.workspace
        and day = new.day
        and id <> new.id;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.subtasks_autocomplete_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.done and not old.done then
    if not exists (
      select 1 from public.subtasks
      where task_id = new.task_id and done = false
    ) then
      update public.tasks set done = true where id = new.task_id and done = false;
    end if;
  end if;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. ตาราง
-- -----------------------------------------------------------------------------

-- ตารางงาน (แทนที่ Sheets แท็บ Tasks)
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  legacy_id text,
  workspace text not null check (workspace in ('Personal','Office')),
  title text not null check (length(btrim(title)) > 0),
  project text not null default '',
  day date,
  week_start date generated always as ((date_trunc('week', day::timestamp))::date) stored,
  done boolean not null default false,
  completed_at timestamptz,
  sort_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, legacy_id),
  check (day is not null or sort_order is null)
);

-- ตารางงานย่อย (แทนที่ Sheets แท็บ Subtasks)
create table if not exists public.subtasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  legacy_id text,
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, legacy_id)
);

-- ตารางโปรเจกต์ (แทนที่ Sheets แท็บ Projects)
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workspace text not null check (workspace in ('Personal','Office')),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, workspace, name)
);

-- ตารางความฝัน (แทนที่ Sheets แท็บ Dreams)
create table if not exists public.dreams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  legacy_id text,
  title text not null check (length(btrim(title)) > 0),
  done boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, legacy_id)
);

-- ตารางดัชนีเลขที่ LINE bot ใช้ (แทนที่ Sheets แท็บ LineIndex)
create table if not exists public.line_index (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  number integer not null check (number > 0),
  task_id uuid not null references public.tasks(id) on delete cascade,
  workspace text not null check (workspace in ('Personal','Office')),
  date_key date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, number)
);

-- -----------------------------------------------------------------------------
-- 3. ดัชนี (index)
-- -----------------------------------------------------------------------------

create index if not exists idx_tasks_user_workspace_day on public.tasks (user_id, workspace, day);
create index if not exists idx_tasks_user_done_completed on public.tasks (user_id, done, completed_at);
create index if not exists idx_subtasks_task_id on public.subtasks (task_id);
create index if not exists idx_subtasks_user_id on public.subtasks (user_id);
create index if not exists idx_projects_user_id on public.projects (user_id);
create index if not exists idx_dreams_user_id on public.dreams (user_id);
create index if not exists idx_line_index_task_id on public.line_index (task_id);

-- -----------------------------------------------------------------------------
-- 4. Trigger
-- -----------------------------------------------------------------------------

drop trigger if exists trg_tasks_set_updated_at on public.tasks;
create trigger trg_tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

drop trigger if exists trg_subtasks_set_updated_at on public.subtasks;
create trigger trg_subtasks_set_updated_at
  before update on public.subtasks
  for each row execute function public.set_updated_at();

drop trigger if exists trg_projects_set_updated_at on public.projects;
create trigger trg_projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

drop trigger if exists trg_dreams_set_updated_at on public.dreams;
create trigger trg_dreams_set_updated_at
  before update on public.dreams
  for each row execute function public.set_updated_at();

drop trigger if exists trg_line_index_set_updated_at on public.line_index;
create trigger trg_line_index_set_updated_at
  before update on public.line_index
  for each row execute function public.set_updated_at();

drop trigger if exists trg_tasks_set_completed_at on public.tasks;
create trigger trg_tasks_set_completed_at
  before insert or update on public.tasks
  for each row execute function public.set_completed_at();

drop trigger if exists trg_dreams_set_completed_at on public.dreams;
create trigger trg_dreams_set_completed_at
  before insert or update on public.dreams
  for each row execute function public.set_completed_at();

drop trigger if exists trg_tasks_append_order on public.tasks;
create trigger trg_tasks_append_order
  before insert or update on public.tasks
  for each row execute function public.tasks_append_order();

drop trigger if exists trg_subtasks_autocomplete_parent on public.subtasks;
create trigger trg_subtasks_autocomplete_parent
  after update of done on public.subtasks
  for each row execute function public.subtasks_autocomplete_parent();

-- -----------------------------------------------------------------------------
-- 5. Grants — ไม่ให้สิทธิ์ anon เลย
-- -----------------------------------------------------------------------------

grant usage on schema public to authenticated, service_role;

revoke all on public.tasks from anon;
grant select, insert, update, delete on public.tasks to authenticated;
grant all on public.tasks to service_role;

revoke all on public.subtasks from anon;
grant select, insert, update, delete on public.subtasks to authenticated;
grant all on public.subtasks to service_role;

revoke all on public.projects from anon;
grant select, insert, update, delete on public.projects to authenticated;
grant all on public.projects to service_role;

revoke all on public.dreams from anon;
grant select, insert, update, delete on public.dreams to authenticated;
grant all on public.dreams to service_role;

revoke all on public.line_index from anon;
grant select, insert, update, delete on public.line_index to authenticated;
grant all on public.line_index to service_role;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.set_completed_at() from public, anon, authenticated;
revoke execute on function public.tasks_append_order() from public, anon, authenticated;
revoke execute on function public.subtasks_autocomplete_parent() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Row Level Security — เจ้าของแถวเท่านั้นที่เข้าถึงได้ ไม่มี policy ให้ anon
-- -----------------------------------------------------------------------------

alter table public.tasks enable row level security;
drop policy if exists tasks_select_own on public.tasks;
create policy tasks_select_own on public.tasks for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists tasks_insert_own on public.tasks;
create policy tasks_insert_own on public.tasks for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists tasks_update_own on public.tasks;
create policy tasks_update_own on public.tasks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists tasks_delete_own on public.tasks;
create policy tasks_delete_own on public.tasks for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.subtasks enable row level security;
drop policy if exists subtasks_select_own on public.subtasks;
create policy subtasks_select_own on public.subtasks for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists subtasks_insert_own on public.subtasks;
create policy subtasks_insert_own on public.subtasks for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists subtasks_update_own on public.subtasks;
create policy subtasks_update_own on public.subtasks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists subtasks_delete_own on public.subtasks;
create policy subtasks_delete_own on public.subtasks for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.projects enable row level security;
drop policy if exists projects_select_own on public.projects;
create policy projects_select_own on public.projects for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists projects_insert_own on public.projects;
create policy projects_insert_own on public.projects for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists projects_update_own on public.projects;
create policy projects_update_own on public.projects for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists projects_delete_own on public.projects;
create policy projects_delete_own on public.projects for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.dreams enable row level security;
drop policy if exists dreams_select_own on public.dreams;
create policy dreams_select_own on public.dreams for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists dreams_insert_own on public.dreams;
create policy dreams_insert_own on public.dreams for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists dreams_update_own on public.dreams;
create policy dreams_update_own on public.dreams for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists dreams_delete_own on public.dreams;
create policy dreams_delete_own on public.dreams for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.line_index enable row level security;
drop policy if exists line_index_select_own on public.line_index;
create policy line_index_select_own on public.line_index for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists line_index_insert_own on public.line_index;
create policy line_index_insert_own on public.line_index for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists line_index_update_own on public.line_index;
create policy line_index_update_own on public.line_index for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists line_index_delete_own on public.line_index;
create policy line_index_delete_own on public.line_index for delete to authenticated using ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- 7. Realtime — เพิ่ม tasks, subtasks, projects, dreams (ไม่รวม line_index)
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'subtasks'
  ) then
    alter publication supabase_realtime add table public.subtasks;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'projects'
  ) then
    alter publication supabase_realtime add table public.projects;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dreams'
  ) then
    alter publication supabase_realtime add table public.dreams;
  end if;
end $$;

commit;

-- -----------------------------------------------------------------------------
-- 8. สรุปผล — ควรเห็น 5 แถว rowsecurity = true
-- -----------------------------------------------------------------------------

select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
