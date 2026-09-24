-- =============================================================================
-- L2P4_cutover_cron.sql
-- คืออะไร: ตั้ง pg_cron job ให้เรียก public.weekly_carry_over() อัตโนมัติทุกสัปดาห์ แทนที่
--   trigger รายสัปดาห์เดิมของ Apps Script (installWeeklyTrigger ใน apps-script/Triggers.gs)
--
-- **รันไฟล์นี้เฉพาะวัน switch-over เท่านั้น** (วันที่ย้ายให้ docs/next/ กลายเป็น docs/ root จริง)
-- อย่ารันก่อนหน้านั้น ไม่งั้นจะมีทั้ง Apps Script trigger เดิม และ pg_cron ใหม่ยกงานซ้ำซ้อนกัน
--
-- วิธีใช้: เปิด Supabase Dashboard -> SQL Editor -> วางไฟล์นี้ทั้งไฟล์ -> กด Run
-- ไฟล์นี้ re-runnable: unschedule job ชื่อเดิมก่อนเสมอ (guarded ด้วย IF EXISTS ผ่าน cron.job) แล้วค่อย
-- schedule ใหม่ รันซ้ำกี่ครั้งก็ได้ ไม่มี job ซ้อนกัน
-- =============================================================================

create extension if not exists pg_cron;

-- ยกเลิก job เดิมชื่อ 'weekly-carry-over' ถ้ามีอยู่แล้ว (guarded — เช็คก่อนว่ามีจริงถึงจะ unschedule)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'weekly-carry-over') then
    perform cron.unschedule('weekly-carry-over');
  end if;
end;
$$;

-- คำนวณตารางเวลา: apps-script/Triggers.gs:installWeeklyTrigger ตั้ง trigger แบบ
--   .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(0)   -- วันจันทร์ ช่วง 00:00–00:59 น. เวลา Asia/Bangkok
-- Asia/Bangkok คือ UTC+7 ตลอดปี (ไม่มี DST) ดังนั้น:
--   วันจันทร์ 00:00 น. เวลาไทย (ICT, UTC+7) = วันอาทิตย์ 17:00 น. UTC
-- แปลงเป็น cron 5 ฟิลด์ (นาที ชั่วโมง วันที่ เดือน วันในสัปดาห์ — 0=อาทิตย์):
--   นาที=0, ชั่วโมง=17 UTC, ทุกวันที่, ทุกเดือน, วันอาทิตย์ (0)
--   => '0 17 * * 0'  (ตรงกับวันจันทร์ 00:00 น. เวลาไทยพอดี ซึ่งอยู่ในช่วง 00:00–00:59 ที่ atHour(0) รับประกัน)
select cron.schedule('weekly-carry-over', '0 17 * * 0', $$select public.weekly_carry_over()$$);

-- ตรวจผล: ต้องเห็น job 'weekly-carry-over' พร้อม schedule '0 17 * * 0'
select jobname, schedule from cron.job;
