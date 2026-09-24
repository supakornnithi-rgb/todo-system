-- รันหลังสร้าง user แล้ว — ไม่ทิ้งข้อมูลทดสอบไว้ ดูผลตาราง PASS/FAIL ด้านล่าง

create temp table if not exists _l2p1_results(n int, test text, result text, detail text);
truncate _l2p1_results;

do $$
declare
  owner uuid;
  res text[] := '{}';
  delim text := chr(31);
  i int;
  parts text[];

  -- T1 / T3
  t1_id1 uuid;
  t1_id2 uuid;
  t1_id3 uuid;
  ord1 int;
  ord2 int;
  ord3 int;

  -- T2
  t2_week date;
  t2_someday_week date;
  t2_someday_order int;

  -- T3
  t3_order int;

  -- T4
  t4_id uuid;
  t4_order int;
  t4_order2 int;

  -- T5
  t5_id uuid;
  t5_completed timestamptz;
  t5_insert_completed timestamptz;

  -- T6
  t6_task_id uuid;
  t6_sub1 uuid;
  t6_sub2 uuid;
  t6_done boolean;
  t6_completed timestamptz;

  -- T7
  t7_id uuid;
  t7_completed timestamptz;

  -- T8
  t8_task_id uuid;
  t8_sub_id uuid;

  -- T9 / T10 / T11
  t9_count int;
  t9_err boolean;
  t10_count int;
  t11_err boolean;
begin
  select id into owner from auth.users order by created_at limit 1;
  if owner is null then
    insert into _l2p1_results(n, test, result, detail)
      values (0, 'L2P1TEST setup', 'FAIL', 'no auth user yet — create the user first');
    return;
  end if;

  begin
    -- T1: append order — 3 Personal tasks on 2030-01-07 without sort_order -> 1,2,3
    begin
      insert into public.tasks (user_id, workspace, title, day)
        values (owner, 'Personal', 'L2P1TEST t1a', '2030-01-07')
        returning id, sort_order into t1_id1, ord1;
      insert into public.tasks (user_id, workspace, title, day)
        values (owner, 'Personal', 'L2P1TEST t1b', '2030-01-07')
        returning id, sort_order into t1_id2, ord2;
      insert into public.tasks (user_id, workspace, title, day)
        values (owner, 'Personal', 'L2P1TEST t1c', '2030-01-07')
        returning id, sort_order into t1_id3, ord3;
      if ord1 = 1 and ord2 = 2 and ord3 = 3 then
        res := res || (1::text || delim || 'T1 append order' || delim || 'PASS' || delim || '');
      else
        raise exception 'got orders %,%,%', ord1, ord2, ord3;
      end if;
    exception when others then
      res := res || (1::text || delim || 'T1 append order' || delim || 'FAIL' || delim || sqlerrm);
    end;

    -- T2: week_start — Thursday 2030-01-10 -> week_start 2030-01-07; someday -> null, null
    begin
      insert into public.tasks (user_id, workspace, title, day)
        values (owner, 'Personal', 'L2P1TEST t2 thu', '2030-01-10')
        returning week_start into t2_week;
      insert into public.tasks (user_id, workspace, title, day)
        values (owner, 'Personal', 'L2P1TEST t2 someday', null)
        returning week_start, sort_order into t2_someday_week, t2_someday_order;
      if t2_week = date '2030-01-07' and t2_someday_week is null and t2_someday_order is null then
        res := res || (2::text || delim || 'T2 week_start' || delim || 'PASS' || delim || '');
      else
        raise exception 'got week_start=%, someday_week=%, someday_order=%', t2_week, t2_someday_week, t2_someday_order;
      end if;
    exception when others then
      res := res || (2::text || delim || 'T2 week_start' || delim || 'FAIL' || delim || sqlerrm);
    end;

    -- T3: move day appends — update T1's first task to a day that already has 1 task -> sort_order = 2
    begin
      insert into public.tasks (user_id, workspace, title, day)
        values (owner, 'Personal', 'L2P1TEST t3 existing', '2030-01-08');
      update public.tasks set day = '2030-01-08' where id = t1_id1
        returning sort_order into t3_order;
      if t3_order = 2 then
        res := res || (3::text || delim || 'T3 move day appends' || delim || 'PASS' || delim || '');
      else
        raise exception 'got sort_order=%', t3_order;
      end if;
    exception when others then
      res := res || (3::text || delim || 'T3 move day appends' || delim || 'FAIL' || delim || sqlerrm);
    end;

    -- T4: explicit order kept on insert, and kept when update sets both day and sort_order
    begin
      insert into public.tasks (user_id, workspace, title, day, sort_order)
        values (owner, 'Personal', 'L2P1TEST t4', '2030-01-07', 50)
        returning id, sort_order into t4_id, t4_order;
      if t4_order <> 50 then
        raise exception 'insert did not keep explicit sort_order, got %', t4_order;
      end if;
      update public.tasks set day = '2030-01-09', sort_order = 77 where id = t4_id
        returning sort_order into t4_order2;
      if t4_order2 = 77 then
        res := res || (4::text || delim || 'T4 explicit order kept' || delim || 'PASS' || delim || '');
      else
        raise exception 'update did not keep explicit sort_order, got %', t4_order2;
      end if;
    exception when others then
      res := res || (4::text || delim || 'T4 explicit order kept' || delim || 'FAIL' || delim || sqlerrm);
    end;

    -- T5: completed_at on tasks
    begin
      insert into public.tasks (user_id, workspace, title, day)
        values (owner, 'Personal', 'L2P1TEST t5', '2030-01-07')
        returning id into t5_id;

      update public.tasks set done = true where id = t5_id returning completed_at into t5_completed;
      if t5_completed is null then
        raise exception 'completed_at not set on done=true';
      end if;

      update public.tasks set done = false where id = t5_id returning completed_at into t5_completed;
      if t5_completed is not null then
        raise exception 'completed_at not cleared on done=false';
      end if;

      insert into public.tasks (user_id, workspace, title, day, done, completed_at)
        values (owner, 'Personal', 'L2P1TEST t5 insert', '2030-01-07', true, '2024-01-01T00:00:00Z')
        returning completed_at into t5_insert_completed;
      if t5_insert_completed <> '2024-01-01T00:00:00Z'::timestamptz then
        raise exception 'explicit completed_at on insert not kept, got %', t5_insert_completed;
      end if;

      res := res || (5::text || delim || 'T5 completed_at' || delim || 'PASS' || delim || '');
    exception when others then
      res := res || (5::text || delim || 'T5 completed_at' || delim || 'FAIL' || delim || sqlerrm);
    end;

    -- T6: auto-complete parent when all subtasks done, never reversed
    begin
      insert into public.tasks (user_id, workspace, title, day)
        values (owner, 'Personal', 'L2P1TEST t6 parent', '2030-01-07')
        returning id into t6_task_id;
      insert into public.subtasks (user_id, task_id, title)
        values (owner, t6_task_id, 'L2P1TEST t6 sub1')
        returning id into t6_sub1;
      insert into public.subtasks (user_id, task_id, title)
        values (owner, t6_task_id, 'L2P1TEST t6 sub2')
        returning id into t6_sub2;

      update public.subtasks set done = true where id = t6_sub1;
      select done into t6_done from public.tasks where id = t6_task_id;
      if t6_done then
        raise exception 'parent completed too early (after 1 of 2 subtasks)';
      end if;

      update public.subtasks set done = true where id = t6_sub2;
      select done, completed_at into t6_done, t6_completed from public.tasks where id = t6_task_id;
      if not t6_done or t6_completed is null then
        raise exception 'parent not auto-completed after all subtasks done';
      end if;

      update public.subtasks set done = false where id = t6_sub1;
      select done into t6_done from public.tasks where id = t6_task_id;
      if not t6_done then
        raise exception 'parent reverted to not-done, should stay done';
      end if;

      res := res || (6::text || delim || 'T6 auto-complete parent' || delim || 'PASS' || delim || '');
    exception when others then
      res := res || (6::text || delim || 'T6 auto-complete parent' || delim || 'FAIL' || delim || sqlerrm);
    end;

    -- T7: completed_at on dreams
    begin
      insert into public.dreams (user_id, title)
        values (owner, 'L2P1TEST t7 dream')
        returning id into t7_id;

      update public.dreams set done = true where id = t7_id returning completed_at into t7_completed;
      if t7_completed is null then
        raise exception 'dream completed_at not set on done=true';
      end if;

      update public.dreams set done = false where id = t7_id returning completed_at into t7_completed;
      if t7_completed is not null then
        raise exception 'dream completed_at not cleared on done=false';
      end if;

      res := res || (7::text || delim || 'T7 dreams completed_at' || delim || 'PASS' || delim || '');
    exception when others then
      res := res || (7::text || delim || 'T7 dreams completed_at' || delim || 'FAIL' || delim || sqlerrm);
    end;

    -- T8: cascade delete — subtasks and line_index rows disappear with the task
    begin
      insert into public.tasks (user_id, workspace, title, day)
        values (owner, 'Personal', 'L2P1TEST t8 task', '2030-01-07')
        returning id into t8_task_id;
      insert into public.subtasks (user_id, task_id, title)
        values (owner, t8_task_id, 'L2P1TEST t8 sub')
        returning id into t8_sub_id;
      insert into public.line_index (user_id, number, task_id, workspace, date_key)
        values (owner, 999901, t8_task_id, 'Personal', '2030-01-07');

      delete from public.tasks where id = t8_task_id;

      if exists (select 1 from public.subtasks where id = t8_sub_id) then
        raise exception 'subtask not cascaded on task delete';
      end if;
      if exists (select 1 from public.line_index where task_id = t8_task_id) then
        raise exception 'line_index not cascaded on task delete';
      end if;

      res := res || (8::text || delim || 'T8 cascade' || delim || 'PASS' || delim || '');
    exception when others then
      res := res || (8::text || delim || 'T8 cascade' || delim || 'FAIL' || delim || sqlerrm);
    end;

    -- T9: RLS stranger — cannot see or insert other people's / owner's rows
    begin
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);

      select count(*) into t9_count from public.tasks where title like 'L2P1TEST%';
      if t9_count <> 0 then
        raise exception 'stranger can see % L2P1TEST rows, expected 0', t9_count;
      end if;

      t9_err := false;
      begin
        insert into public.tasks (user_id, workspace, title, day)
          values (owner, 'Personal', 'L2P1TEST t9 stranger insert', '2030-01-07');
      exception when others then
        t9_err := true;
      end;
      if not t9_err then
        raise exception 'stranger insert with owner user_id did not raise';
      end if;

      res := res || (9::text || delim || 'T9 RLS stranger' || delim || 'PASS' || delim || '');
    exception when others then
      res := res || (9::text || delim || 'T9 RLS stranger' || delim || 'FAIL' || delim || sqlerrm);
    end;

    -- T10: RLS owner — owner sees their own L2P1TEST rows
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', owner::text, 'role', 'authenticated')::text, true);
      select count(*) into t10_count from public.tasks where title like 'L2P1TEST%';
      if t10_count > 0 then
        res := res || (10::text || delim || 'T10 RLS owner' || delim || 'PASS' || delim || '');
      else
        raise exception 'owner sees 0 L2P1TEST rows, expected > 0';
      end if;
    exception when others then
      res := res || (10::text || delim || 'T10 RLS owner' || delim || 'FAIL' || delim || sqlerrm);
    end;

    -- T11: anon blocked — select on tasks must raise permission denied
    begin
      perform set_config('role', 'anon', true);

      t11_err := false;
      begin
        perform count(*) from public.tasks;
      exception when others then
        t11_err := true;
      end;
      if not t11_err then
        raise exception 'anon select on tasks did not raise';
      end if;

      res := res || (11::text || delim || 'T11 anon blocked' || delim || 'PASS' || delim || '');
    exception when others then
      res := res || (11::text || delim || 'T11 anon blocked' || delim || 'FAIL' || delim || sqlerrm);
    end;

    -- restore full rights before anything else runs
    perform set_config('role', 'postgres', true);

    raise exception 'L2P1_ROLLBACK';
  exception
    when others then
      if sqlerrm <> 'L2P1_ROLLBACK' then
        res := res || ('0' || delim || 'L2P1TEST harness' || delim || 'FAIL' || delim || 'unexpected error: ' || sqlerrm);
      end if;
  end;

  -- make sure rights are restored even if the block above exited via an unexpected error
  perform set_config('role', 'postgres', true);

  for i in 1 .. coalesce(array_length(res, 1), 0) loop
    parts := string_to_array(res[i], delim);
    insert into _l2p1_results(n, test, result, detail)
      values (parts[1]::int, parts[2], parts[3], parts[4]);
  end loop;
end $$;

select n, test, result, detail from _l2p1_results order by n;
