-- L2P6_db_usage_grant.sql — ให้แอพ (ผู้ใช้ที่ login แล้ว) อ่านขนาดฐานข้อมูลได้ เพื่อแสดงแถบเตือนเมื่อใช้พื้นที่เกิน 80%
-- ฟังก์ชันนี้คืนแค่ตัวเลขขนาดฐานข้อมูล (ไบต์) ไม่เปิดให้เห็นข้อมูลงานของใคร — วางใน SQL Editor แล้วกด Run (รันซ้ำได้)
grant execute on function public.db_size_bytes() to authenticated;
select has_function_privilege('authenticated', 'public.db_size_bytes()', 'execute') as authenticated_can_read_size;
