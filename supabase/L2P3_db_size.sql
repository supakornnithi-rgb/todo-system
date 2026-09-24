-- =============================================================================
-- L2P3_db_size.sql — ฟังก์ชันเช็คขนาด database ปัจจุบัน (ไบต์) ให้ courier เรียกดูโควตาได้
-- วางทั้งไฟล์ใน SQL Editor แล้วกด Run — รันซ้ำได้ไม่พัง (create or replace / revoke-grant ทุกครั้ง)
-- เรียกใช้จาก Apps Script ผ่าน PostgREST: POST /rest/v1/rpc/db_size_bytes ด้วย secret key (service_role)
-- =============================================================================

create or replace function public.db_size_bytes()
returns bigint language sql stable set search_path = '' as $$ select pg_catalog.pg_database_size(pg_catalog.current_database()) $$;
revoke execute on function public.db_size_bytes() from public, anon, authenticated;
grant execute on function public.db_size_bytes() to service_role;
select public.db_size_bytes() as bytes;
