-- =============================================================================
-- L2P4_rpc.sql
-- คืออะไร: สร้างฟังก์ชัน SQL (RPC) 2 ตัวที่ฝั่งเว็บ (docs/next/) และ cron job ต้องเรียกใช้
--   1) public.set_task_order(p_task_id, p_position) — จัดลำดับงานภายในวันเดียวกันใหม่
--      (ทำแบบเดียวกับ setTaskOrder_ ใน apps-script/Tasks.gs:226-251 ทุกประการ)
--   2) public.weekly_carry_over() — ยกงานที่ยังไม่เสร็จจากสัปดาห์ก่อนๆ มาไว้วันจันทร์สัปดาห์นี้
--      (ทำแบบเดียวกับ weeklyCarryOver ใน apps-script/Triggers.gs)
-- วิธีใช้: เปิด Supabase Dashboard -> SQL Editor -> วางไฟล์นี้ทั้งไฟล์ -> กด Run
-- ไฟล์นี้ re-runnable: ใช้ CREATE OR REPLACE FUNCTION ทุกจุด รันซ้ำกี่ครั้งก็ได้ผลลัพธ์เดิม ปลอดภัย
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1) public.set_task_order(p_task_id uuid, p_position int) returns void
--    security invoker: รันด้วยสิทธิ์ของผู้เรียก (RLS ของ auth.uid() = user_id บังคับใช้ตามปกติ)
--    set search_path = '': กัน search_path hijacking ตามข้อกำหนดความปลอดภัยของ Supabase
-- -----------------------------------------------------------------------------
create or replace function public.set_task_order(p_task_id uuid, p_position int)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
  v_ids uuid[];
  v_n int;
  v_idx int;
  v_i int;
  v_id uuid;
begin
  -- โหลดงานที่จะย้าย — RLS มีผลตามปกติ (security invoker) ถ้าไม่ใช่ของ user นี้จะไม่เจอแถวเลย
  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'ไม่พบงาน id: %', p_task_id;
  end if;
  if v_task.day is null then
    raise exception 'งานใน someday ไม่มีลำดับให้จัด';
  end if;

  -- advisory lock คีย์เดียวกับที่ trigger ต่อท้าย sort_order ใช้ (user_id|workspace|day) กันสองคำขอ
  -- จัดลำดับวันเดียวกันพร้อมกันแล้ว renumber ชนกัน
  perform pg_advisory_xact_lock(hashtext(v_task.user_id::text || '|' || v_task.workspace || '|' || v_task.day::text));

  -- siblings: user_id+workspace+day เดียวกัน ไม่รวมตัวที่กำลังย้าย เรียงตาม sort_order (nulls last) แล้ว created_at
  select coalesce(array_agg(id order by sort_order nulls last, created_at), '{}'::uuid[])
    into v_ids
  from public.tasks
  where user_id = v_task.user_id
    and workspace = v_task.workspace
    and day = v_task.day
    and id <> p_task_id;

  v_n := coalesce(array_length(v_ids, 1), 0);

  -- clamp ตำแหน่งที่ต้องการ (1-indexed) ให้อยู่ในช่วง [1, n+1] เหมือน Tasks.gs:235 เป๊ะ
  v_idx := greatest(1, least(p_position, v_n + 1));

  -- แทรกงานที่ย้ายเข้าไปที่ตำแหน่ง v_idx ในลิสต์ siblings (array slice แบบ 1-indexed ของ Postgres)
  v_ids := v_ids[1:v_idx - 1] || p_task_id || v_ids[v_idx:v_n];

  -- renumber ทั้งลิสต์ใหม่เป็น 1..N ต่อเนื่อง — update เฉพาะแถวที่ sort_order เปลี่ยนจริงเท่านั้น
  for v_i in 1..array_length(v_ids, 1) loop
    v_id := v_ids[v_i];
    update public.tasks
      set sort_order = v_i
      where id = v_id
        and sort_order is distinct from v_i;
  end loop;
end;
$$;

revoke all on function public.set_task_order(uuid, int) from public;
revoke all on function public.set_task_order(uuid, int) from anon;
grant execute on function public.set_task_order(uuid, int) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) public.weekly_carry_over() returns int
--    ยกงานที่ done=false และมี day (ไม่ใช่ someday) ที่ week_start เก่ากว่าจันทร์สัปดาห์นี้ (Asia/Bangkok)
--    มาไว้ที่วันจันทร์สัปดาห์นี้ — trigger การ append sort_order ต่อท้ายทำให้เองอัตโนมัติ (ไม่ต้องคำนวณที่นี่)
--    ไม่ grant execute ให้ใครเลย (แม้แต่ authenticated) — ฟังก์ชันนี้มีไว้ให้ pg_cron เรียกเท่านั้น
--    (pg_cron รันงานด้วย role ของผู้ schedule ซึ่งปกติคือ postgres/superuser จึงข้าม RLS ได้ตามปกติ
--    โดยไม่ต้องใช้ security definer)
-- -----------------------------------------------------------------------------
create or replace function public.weekly_carry_over()
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_monday date;
  v_count int;
begin
  v_monday := (date_trunc('week', (now() at time zone 'Asia/Bangkok')::date::timestamp))::date;

  update public.tasks
    set day = v_monday
    where done = false
      and day is not null
      and week_start < v_monday;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.weekly_carry_over() from public;
revoke all on function public.weekly_carry_over() from anon;
revoke all on function public.weekly_carry_over() from authenticated;

commit;

-- -----------------------------------------------------------------------------
-- ตรวจผล: ต้องเห็นทั้ง 2 ฟังก์ชันอยู่ใน schema public
-- -----------------------------------------------------------------------------
select p.proname as function_name, n.nspname as schema_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('set_task_order', 'weekly_carry_over');
