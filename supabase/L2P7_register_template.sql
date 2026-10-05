-- =============================================================================
-- L2P7_register_template.sql — ลงทะเบียน LINE userId ให้ผู้ใช้ใหม่ (ตัวอย่างนี้: Pink)
-- วิธีใช้:
--   1) ให้คนนั้นทัก bot ใน LINE หนึ่งครั้ง bot จะตอบกลับรหัส LINE userId (ขึ้นต้นด้วย U...)
--   2) แทนที่ <LINE_USER_ID> ด้านล่างด้วยรหัสนั้น (คงเครื่องหมาย ' ' ไว้)
--   3) เปิด Supabase Dashboard -> SQL Editor -> วาง -> Run (รันต่อคนใหม่หนึ่งครั้ง)
-- รันซ้ำได้ไม่พัง: ถ้า LINE userId นี้มีอยู่แล้วจะอัปเดต user_id/ชื่อให้ (upsert)
-- ถ้าเพิ่มคนอื่น ให้เปลี่ยนอีเมลและชื่อที่แสดงด้วย
-- =============================================================================

insert into public.line_users(line_user_id, user_id, display_name)
select '<LINE_USER_ID>', id, 'Pink' from auth.users where lower(email) = 'pinkypikkyy@gmail.com'
on conflict (line_user_id) do update set user_id = excluded.user_id, display_name = excluded.display_name;

select l.display_name, u.email, l.line_user_id from public.line_users l join auth.users u on u.id = l.user_id;
