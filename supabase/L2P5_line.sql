-- =============================================================================
-- L2P5_line.sql — ตารางกันประมวลผลซ้ำ (de-dup) สำหรับ Edge Function line-webhook
-- วิธีใช้: เปิด Supabase Dashboard -> SQL Editor -> วางไฟล์นี้ทั้งไฟล์ -> กด Run
-- รันซ้ำได้ไม่พัง (idempotent) — ใช้ create table if not exists และ grant/revoke ซ้ำได้เสมอ
--
-- ตาราง line_index เดิมมีอยู่แล้วจาก L2P1_schema.sql (พร้อม grant ให้ service_role แล้ว)
-- ไฟล์นี้เพิ่มแค่ตารางใหม่ที่ยังไม่เคยมี: public.line_events
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- line_events: เก็บ LINE webhookEventId ที่เคยประมวลผลไปแล้ว กัน LINE ส่ง event เดิมซ้ำมา
-- (เช่นตอน Edge Function ตอบช้า/หลุดกลางทาง LINE จะ retry ส่ง event เดิมมาใหม่)
-- ไม่มีคอลัมน์ user_id เพราะ bot ตัวนี้มีเจ้าของคนเดียว (single-user app) และ webhookEventId
-- เป็นค่าที่ LINE การันตีว่าไม่ซ้ำกันในระดับ channel อยู่แล้ว
-- แถวเก่าเกิน 7 วันจะถูกลบทิ้งโดย Edge Function เอง (best effort) ไม่ต้องมี cron แยก
-- -----------------------------------------------------------------------------
create table if not exists public.line_events (
  event_id text primary key,
  created_at timestamptz not null default now()
);

-- ไม่มี policy ใดๆ เลย — RLS เปิดไว้เฉยๆ เพื่อปิดกั้นทุก role ที่ไม่ใช่ service_role (ซึ่ง bypass RLS
-- อยู่แล้วโดยธรรมชาติของ Supabase) ตารางนี้ไม่มี user_id ให้ auth.uid() เทียบ จึงห้าม anon/authenticated
-- แตะเด็ดขาดผ่าน revoke ด้านล่างแทนการเขียน policy
alter table public.line_events enable row level security;

revoke all on public.line_events from anon, authenticated;
grant all on public.line_events to service_role;

commit;

-- -----------------------------------------------------------------------------
-- ตรวจผล: ต้องเห็นตาราง line_events อยู่ใน schema public
-- -----------------------------------------------------------------------------
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'line_events';
