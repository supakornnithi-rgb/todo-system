// ตั้งค่า Supabase ตรงนี้จุดเดียว — publishable key ไม่ใช่ความลับ (RLS ป้องกันข้อมูลจริงอยู่แล้ว)
// เหมือน API_URL เดิมของ docs/app.js แค่ย้ายมาไฟล์แยกเพราะตอนนี้มีค่าคอนฟิกมากกว่า 1 ค่า
const SUPABASE_URL = 'https://rktswjqngkwzbvxdtbkv.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_F-W7k5NlqYBG-kKMZt5lwg_8YFaSFQl';

// prefix ของทุก localStorage key ในบิลด์นี้ — กันชนกับ key เดิม (ts_...) ของแอปที่ docs/ root
// ซึ่งอยู่ origin เดียวกัน (สอง service worker คนละ scope แต่ localStorage share กันทั้ง origin)
const STORAGE_PREFIX = 'ts2_';

// true เมื่อรันอยู่ใต้ /next/ (ตอนย้ายไป docs/ root ตอน switch-over ค่านี้จะกลายเป็น false เอง
// เพราะเช็คจาก path จริง ไม่ต้องแก้โค้ด)
const IS_TEST_BUILD = location.pathname.indexOf('/next/') !== -1;
