-- =============================================================================
-- L2P7_line_users.sql — ตารางจับคู่ LINE userId -> ผู้ใช้ในแอพ (รองรับ LINE bot หลายคน)
-- วิธีใช้: เปิด Supabase Dashboard -> SQL Editor -> วางไฟล์นี้ทั้งไฟล์ -> กด Run
-- รันซ้ำได้ไม่พัง (idempotent) — create table if not exists, grant/revoke ซ้ำได้, seed ใช้ on conflict do nothing
--
-- ตารางนี้ใช้โดย Edge Function line-webhook (หา user_id จาก LINE userId ของผู้ส่ง) และ Apps Script
-- sendDailySummarySupabase (วนส่งสรุปงานให้ทุกคนที่ลงทะเบียน) — ทั้งสองใช้ service_role เท่านั้น
-- เพิ่มคนใหม่: ใช้ L2P7_register_template.sql
-- =============================================================================

begin;

create table if not exists public.line_users (
  line_user_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

-- เปิด RLS โดยไม่มี policy — ปิดกั้นทุก role ที่ไม่ใช่ service_role (ซึ่ง bypass RLS อยู่แล้ว)
alter table public.line_users enable row level security;

revoke all on public.line_users from anon, authenticated;
grant all on public.line_users to service_role;

-- seed เจ้าของ (หา user_id จากอีเมล ไม่ hardcode uuid)
insert into public.line_users(line_user_id, user_id, display_name)
select 'Ueecd92962b4513ea94bf1f53e7634ff1', id, 'Bank' from auth.users
where lower(email) = 'supakorn.nithi@gmail.com'
on conflict (line_user_id) do nothing;

commit;

-- ตรวจผล: ต้องเห็นอย่างน้อยแถวของเจ้าของ (Bank)
select l.display_name, u.email, l.line_user_id from public.line_users l join auth.users u on u.id = l.user_id;
