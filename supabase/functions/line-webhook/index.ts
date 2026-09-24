// index.ts — Supabase Edge Function: webhook ของ LINE bot (แทนที่ apps-script/Line.gs ฝั่งรับคำสั่ง)
//
// ทำอะไร: รับ event จาก LINE (ข้อความพิมพ์เอง + ปุ่ม ✓ ในการ์ดสรุปงาน) ตรวจลายเซ็นกันคนอื่นยิงมาปลอม
// แปลคำสั่งด้วย logic.js (พอร์ตมาจาก Line.gs คำต่อคำ) แล้วอ่าน/เขียนตาราง tasks/line_index ใน Supabase
// ตรงกับ Line.gs ทุกประการ ยกเว้น 2 จุดที่ตั้งใจเปลี่ยน: (1) ปุ่ม ✓ ตอบกลับทันทีทุกครั้ง ไม่ debounce
// 1 นาทีแบบเดิมอีกต่อไป (เพราะ reply ไม่กินโควตา push 200 ข้อความ/เดือน) (2) ข้อความตอบปุ่ม ✓ เปลี่ยนเป็น
// "✓ เสร็จ: <ชื่องาน>" ต่อบรรทัด
//
// secret ที่ต้องตั้งไว้ล่วงหน้า (Dashboard -> Edge Functions -> line-webhook -> Secrets):
//   LINE_CHANNEL_ACCESS_TOKEN — token สำหรับเรียก LINE Messaging API (reply)
//   LINE_CHANNEL_SECRET       — ใช้ตรวจ X-Line-Signature
//   LINE_USER_ID              — userId ของเจ้าของ (allowlist คนเดียว)
//   OWNER_ID                  — uuid ของเจ้าของใน Supabase auth (ใช้ scope ทุก query)
// SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY มาจาก Edge Function runtime เองอัตโนมัติ ไม่ต้องตั้งเอง
//
// คำสั่ง deploy:
//   npx supabase functions deploy line-webhook --project-ref rktswjqngkwzbvxdtbkv --no-verify-jwt
// webhook URL ที่เอาไปตั้งใน LINE Developers Console:
//   https://rktswjqngkwzbvxdtbkv.supabase.co/functions/v1/line-webhook

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  parseCommand,
  dateOfWeekday,
  bangkokTodayIso,
  formatReply,
  verifyLineSignature,
} from './logic.js';

const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply'; // Line.gs:15

// housekeeping: ลบแถว line_events เก่าเกินกี่วัน (ดู TASKS Task 3 ข้อ 5)
const LINE_EVENTS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function supabaseClient_() {
  const url = Deno.env.get('SUPABASE_URL')!;
  // โปรเจกต์ที่ใช้ API key รุ่นใหม่ (sb_secret_...) อาจไม่มี legacy service_role key ให้ — ถ้าตั้ง secret
  // SB_SECRET_KEY ไว้ (ค่าเดียวกับ SUPABASE_SECRET_KEY ใน Apps Script) จะใช้ตัวนั้นก่อน
  const key = Deno.env.get('SB_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key);
}

async function callLineReply_(replyToken: string, text: string): Promise<void> {
  const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')!;
  const res = await fetch(LINE_REPLY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) {
    // ไม่ push แทน (ตาม CONSTRAINTS: ห้าม push จาก Edge Function เด็ดขาด) แค่ log ไว้เท่านั้น — Task 3 ข้อ 4
    console.error('LINE reply ล้มเหลว (' + res.status + '): ' + (await res.text()));
  }
}

// เลขงาน -> {taskId, workspace} ผ่าน line_index ของ OWNER_ID เท่านั้น (พอร์ตจาก resolveLineNumbers_ Line.gs:182-191)
async function resolveLineNumbers_(
  supabase: ReturnType<typeof createClient>,
  ownerId: string,
  numbers: number[]
): Promise<{ number: number; task_id: string; workspace: string }[]> {
  const { data, error } = await supabase
    .from('line_index')
    .select('number, task_id, workspace')
    .eq('user_id', ownerId)
    .in('number', numbers);
  if (error) throw new Error(error.message);

  const byNumber: Record<number, { number: number; task_id: string; workspace: string }> = {};
  (data || []).forEach((row: any) => { byNumber[row.number] = row; });

  return numbers.map((n) => {
    const row = byNumber[n];
    if (!row) throw new Error('ไม่พบเลขงาน ' + n + ' ในข้อความล่าสุด'); // resolveLineNumbers_ Line.gs:188
    return row;
  });
}

async function runCommand_(
  supabase: ReturnType<typeof createClient>,
  ownerId: string,
  cmd: ReturnType<typeof parseCommand>,
  isPostback: boolean
): Promise<string> {
  if (cmd.type === 'help') return formatReply('help', { cmd: (cmd as any).cmd });
  if (cmd.type === 'error') return formatReply('error', { message: (cmd as any).message });

  if (cmd.type === 'move') {
    const { numbers, dayWord, dayIndex } = cmd as any;
    const rows = await resolveLineNumbers_(supabase, ownerId, numbers);
    const targetDate = dateOfWeekday(dayIndex, bangkokTodayIso(Date.now()));
    const titles: string[] = [];
    for (const row of rows) {
      // ไม่ส่ง sort_order — trigger tasks_append_order ต่อท้ายให้เอง (CONSTRAINTS)
      const { data, error } = await supabase
        .from('tasks')
        .update({ day: targetDate })
        .eq('id', row.task_id)
        .eq('user_id', ownerId)
        .select('title')
        .single();
      if (error) throw new Error(error.message);
      titles.push((data as any).title);
    }
    return formatReply('move', { titles, dayWord });
  }

  if (cmd.type === 'someday') {
    const { numbers } = cmd as any;
    const rows = await resolveLineNumbers_(supabase, ownerId, numbers);
    const titles: string[] = [];
    for (const row of rows) {
      const { data, error } = await supabase
        .from('tasks')
        .update({ day: null })
        .eq('id', row.task_id)
        .eq('user_id', ownerId)
        .select('title')
        .single();
      if (error) throw new Error(error.message);
      titles.push((data as any).title);
    }
    return formatReply('someday', { titles });
  }

  if (cmd.type === 'done') {
    const { numbers } = cmd as any;
    const rows = await resolveLineNumbers_(supabase, ownerId, numbers);
    const titles: string[] = [];
    for (const row of rows) {
      const { data, error } = await supabase
        .from('tasks')
        .update({ done: true }) // trigger set_completed_at ประทับเวลาให้เอง (CONSTRAINTS)
        .eq('id', row.task_id)
        .eq('user_id', ownerId)
        .select('title')
        .single();
      if (error) throw new Error(error.message);
      titles.push((data as any).title);
    }
    // ปุ่ม ✓ กับพิมพ์ "เสร็จ <เลข>" เอง ใช้ reply คนละแบบ (ดู formatPostbackDoneReply ใน logic.js)
    return isPostback ? formatReply('postbackDone', { titles }) : formatReply('done', { titles });
  }

  if (cmd.type === 'add') {
    const { workspace, title } = cmd as any;
    const todayIso = bangkokTodayIso(Date.now());
    const { data, error } = await supabase
      .from('tasks')
      .insert({ user_id: ownerId, workspace, title, day: todayIso })
      .select('title')
      .single();
    if (error) throw new Error(error.message);
    return formatReply('add', { title: (data as any).title, workspace });
  }

  return formatReply('help', { cmd: '' });
}

// ประมวลผล event เดียว — ผิดพลาดตรงไหนใน event นี้ ห้ามให้กระทบ event อื่นในชุดเดียวกัน (Task 3 ข้อ 4 ข้อสุดท้าย)
async function processEvent_(
  supabase: ReturnType<typeof createClient>,
  ownerLineUserId: string,
  ownerId: string,
  event: any
): Promise<void> {
  let text: string | undefined;
  let isPostback = false;

  if (event.type === 'message' && event.message && event.message.type === 'text') {
    text = (event.message.text || '').trim(); // Line.gs:50
  } else if (event.type === 'postback' && event.postback) {
    text = (event.postback.data || '').trim(); // Line.gs:52
    isPostback = true;
  } else {
    return; // Line.gs:53-55 ไม่ใช่ message/text หรือ postback ก็ข้าม
  }

  const userId = event.source && event.source.userId;
  if (!userId) return; // Line.gs:57-58

  const replyToken = event.replyToken;

  // ครอบทุกอย่างตั้งแต่ตรงนี้ด้วย try/catch ชั้นนอกสุด — ผิดพลาดอะไรก็ตามที่ไม่ใช่ความล้มเหลวของ
  // คำสั่งปกติ (เช่น de-dup insert ล้มเหลวด้วยเหตุอื่น, ปุ่ม ✓ ที่ resolveLineNumbers_ ยังไม่ทันโดน
  // จับใน try ชั้นในเพราะ error หลุดออกมาจากที่อื่น) ให้ reply "เกิดข้อผิดพลาด: <message>" แบบ best effort
  // แล้วปล่อยผ่าน ไม่ throw ต่อ กัน event นี้พัง event อื่นในชุดเดียวกัน (Task 3 ข้อ 4 บรรทัดสุดท้าย)
  try {
    // allowlist — ต้องตรงกับ LINE_USER_ID เท่านั้น ถ้าไม่ตรง (คนอื่นทัก) ไม่ตอบสนองเลย (Line.gs:77)
    // ถ้ายังไม่ได้ตั้งค่า LINE_USER_ID เลย (secret ว่าง) พอร์ตพฤติกรรมเดิม Line.gs:70-76: บอก userId กลับไป
    if (!ownerLineUserId) {
      await callLineReply_(
        replyToken,
        'ยังไม่ได้ตั้งค่า LINE_USER_ID ครับ\nuserId ของคุณคือ:\n' + userId +
          '\n\nเอาค่านี้ไปใส่ secret ชื่อ LINE_USER_ID ใน Supabase Edge Function แล้วลองพิมพ์คำสั่งใหม่อีกครั้ง'
      );
      return;
    }
    if (userId !== ownerLineUserId) return; // Line.gs:77

    // de-dup ผ่าน line_events — insert ถ้าชนกัน (unique violation 23505) แปลว่าเคยประมวลผลไปแล้ว ข้ามเลย
    // ถ้าไม่มี webhookEventId ส่งมาเลย (ไม่ควรเกิดกับ LINE จริง) ประมวลผลไปเลยตามที่ Task 3 ข้อ 4 ระบุ
    if (event.webhookEventId) {
      const { error } = await supabase
        .from('line_events')
        .insert({ event_id: event.webhookEventId });
      if (error) {
        if (error.code === '23505') return; // เคยประมวลผลแล้ว ข้าม
        throw new Error(error.message); // ล้มเหลวด้วยเหตุอื่น (เช่น DB ล่ม) — ตกไปที่ catch ชั้นนอกสุด
      }
    }

    // ชั้นในนี้เทียบเท่า processLineEvent_ ของ Line.gs:79-86 พอดี — ความล้มเหลว "ปกติ" ของคำสั่ง
    // (พารามิเตอร์ผิด/เลขงานไม่พบ/ชื่อวันไม่รู้จัก ฯลฯ) ใช้คำไทยชุดเดียวกับ Line.gs เป๊ะผ่าน formatReply
    let replyText: string;
    try {
      const cmd = parseCommand(text);
      replyText = await runCommand_(supabase, ownerId, cmd, isPostback);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      replyText = formatReply('error', { message }); // Line.gs:82-85 "ทำคำสั่งไม่สำเร็จ: ..."
    }

    await callLineReply_(replyToken, replyText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await callLineReply_(replyToken, 'เกิดข้อผิดพลาด: ' + message); // Task 3 ข้อ 4 บรรทัดสุดท้าย
    } catch {
      // best effort เท่านั้น — reply เองก็พังอีกก็ปล่อยผ่าน ไม่ให้กระทบ event ถัดไป
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 }); // Task 3 ข้อ 1
  }

  const rawBody = await req.text();

  const signature = req.headers.get('X-Line-Signature');
  const channelSecret = Deno.env.get('LINE_CHANNEL_SECRET')!;
  const valid = await verifyLineSignature(channelSecret, rawBody, signature || '');
  if (!valid) {
    // ลายเซ็นขาด/ไม่ตรง — ตอบ 401 แล้วไม่ทำอะไรต่อเลย (Task 3 ข้อ 2)
    return new Response('Unauthorized', { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = {};
  }

  const events = body.events || [];
  if (events.length === 0) {
    // ปุ่ม Verify ของ LINE ส่ง events ว่างมา — Task 3 ข้อ 3
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ownerLineUserId = Deno.env.get('LINE_USER_ID') || '';
  const ownerId = Deno.env.get('OWNER_ID')!;
  const supabase = supabaseClient_();

  // ประมวลผลทีละ event ตามลำดับ (ไม่ขนาน) เหมือน Line.gs:38 ((body.events || []).forEach(...))
  for (const event of events) {
    try {
      await processEvent_(supabase, ownerLineUserId, ownerId, event);
    } catch (err) {
      // เผื่อ error หลุดจาก processEvent_ เอง (เช่น de-dup insert ล้มเหลวด้วยเหตุอื่น) — event ถัดไปต้องรันต่อ
      console.error('processEvent_ ล้มเหลว:', err);
    }
  }

  // housekeeping: ลบ line_events เก่าเกิน 7 วัน แบบ best effort (ไม่ throw ถ้าพลาด) — Task 3 ข้อ 5
  try {
    const cutoffIso = new Date(Date.now() - LINE_EVENTS_MAX_AGE_MS).toISOString();
    await supabase.from('line_events').delete().lt('created_at', cutoffIso);
  } catch (err) {
    console.error('ลบ line_events เก่าไม่สำเร็จ (ข้ามไป ไม่กระทบการตอบ 200):', err);
  }

  // ตอบ 200 เสมอเมื่อผ่านการตรวจลายเซ็นแล้ว แม้บางคำสั่งจะล้มเหลว กัน LINE ส่ง event เดิมมาซ้ำ — Task 3 ข้อ 6
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
