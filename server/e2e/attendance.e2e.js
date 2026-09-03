#!/usr/bin/env node
/**
 * KneaChat — Attendance feature end-to-end check (no browser).
 *
 * Exercises the full employee working-time & attendance flow against a live
 * backend (:8080) with the seeded demo users:
 *
 *   Employee (maya)    → today card, clock in (WS events to self + manager),
 *                        duplicate clock-in guard, break start/end, clock out,
 *                        month calendar, own schedule, leave request (+ overlap
 *                        guard), overtime request.
 *   Manager (dara)     → live dashboard, employee×day table, monthly report,
 *                        employee detail, schedule upsert, leave approval,
 *                        holiday CRUD.
 *   Permissions        → employees are blocked from manager endpoints and
 *                        cannot approve leave / create holidays.
 *
 * Leaves a clean database behind (marker-based SQL cleanup).
 *
 * Requirements: a running backend (:8080) with seeded demo users and the
 * attendance tables (migration 017).
 *
 * Usage:
 *   npm run test:e2e:attendance
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const WebSocket = require('ws');

const API_BASE = process.env.API_BASE || 'http://localhost:8080';
const WS_BASE = process.env.WS_BASE || 'ws://localhost:8080';
const PASSWORD = process.env.E2E_PASSWORD || 'kneachat168';
const MARKER = `att-${process.pid}-${Date.now().toString(36)}`;

const EMPLOYEE_EMAIL = 'maya@kneachat.com'; // employee
const MANAGER_EMAIL = 'dara@kneachat.com'; // manager

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

function section(title) {
  console.log(`\n── ${title} ─${'─'.repeat(Math.max(0, 56 - title.length))}`);
}

/** Small sleep helper. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(pathname, { method = 'GET', token, body, retry429 = false } = {}) {
  const attempt = async () => {
    const res = await fetch(`${API_BASE}${pathname}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON body */
    }
    return { status: res.status, json, retryAfter: Number(res.headers.get('Retry-After')) || 0 };
  };
  let result = await attempt();
  // The clock endpoints are rate-limited (10/min per IP); when a previous
  // run left the window full, wait it out and retry once.
  if (retry429 && result.status === 429) {
    const waitMs = (result.retryAfter || 61) * 1000;
    console.log(`    … rate limited (429) — waiting ${waitMs / 1000}s before retry`);
    await sleep(waitMs);
    result = await attempt();
  }
  return result;
}

async function login(email) {
  const { status, json } = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password: PASSWORD },
  });
  if (status !== 200 || !json?.data?.token) {
    throw new Error(`Login failed for ${email} (HTTP ${status}): ${JSON.stringify(json)}`);
  }
  return json.data;
}

/** Collect WebSocket events of a given type for `ms` (resolves with names). */
function collectEvents(token, types, ms = 2500) {
  return new Promise((resolve) => {
    const seen = new Set();
    let ws;
    try {
      ws = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token)}`);
    } catch (error) {
      resolve({ seen, error: error.message });
      return;
    }
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve({ seen, error: null });
    }, ms);
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (types.includes(msg.type)) seen.add(msg.type);
      } catch {
        /* ignore malformed */
      }
    });
    ws.on('error', (error) => {
      clearTimeout(timer);
      resolve({ seen, error: error.message });
    });
  });
}

async function main() {
  console.log('KneaChat E2E — attendance feature');
  console.log(`  API : ${API_BASE}`);
  console.log(`  mark: ${MARKER}`);

  // 0. Preflight.
  section('Preflight');
  let health;
  try {
    health = await api('/api/health');
  } catch {
    health = { status: 0 };
  }
  if (health.status !== 200) {
    console.log(`  ❌ Cannot reach KneaChat API at ${API_BASE}/api/health`);
    console.log('     Start the backend first: cd server && npm run dev');
    process.exit(1);
  }
  console.log('  ✅ Server is up');

  section('Authentication');
  const employee = await login(EMPLOYEE_EMAIL);
  const manager = await login(MANAGER_EMAIL);
  const empId = employee.user.id;
  const empToken = employee.token;
  const mgrToken = manager.token;
  check(`employee logged in (${EMPLOYEE_EMAIL}, id ${empId})`, !!empToken);
  check(`manager logged in (${MANAGER_EMAIL}, id ${manager.user.id})`, !!mgrToken);

  // Clean up any previous run for the same day so clock-in is deterministic.
  section('Setup (SQL)');
  try {
    const connection = require('../dist/src/database/connection');
    const db = connection.default || connection;
    const breaks = await db.query(
      `SELECT b.id FROM break_records b
       JOIN attendance_records a ON a.id = b.attendance_id
       WHERE a.employee_id = ? AND a.date = CURDATE()`,
      [empId],
    );
    if (breaks.length) {
      await db.query('DELETE FROM break_records WHERE id IN (?)', [breaks.map((b) => b.id)]);
    }
    // Sweep every attendance-e2e row (any previous run), not just this run's
    // marker — a leftover pending leave would otherwise block the new one.
    await db.query('DELETE FROM attendance_records WHERE employee_id = ? AND date = CURDATE()', [empId]);
    await db.query('DELETE FROM overtime_records WHERE reason LIKE ?', ['att-%']);
    await db.query('DELETE FROM leave_requests WHERE reason LIKE ?', ['att-%']);
    await db.query('DELETE FROM holidays WHERE name LIKE ?', ['E2E Holiday %']);
    console.log('  ✅ Removed previous run rows for today');
  } catch (error) {
    console.warn(`  ⚠  Setup SQL skipped: ${error.message}`);
  }

  // ---------------------------------------------------------------------
  section('Employee — today card & clock in');
  const before = await api('/api/attendance/me/today', { token: empToken });
  check('me/today returns today with schedule', before.status === 200 && before.json?.data?.day?.date, `status ${before.status}`);
  check('today is a working day (Thu) with 480 required minutes', before.json?.data?.day?.is_working_day === true && before.json?.data?.day?.required_work_minutes === 480);

  // Watch for WS events BEFORE clocking in.
  const mgrWs = collectEvents(mgrToken, ['attendance:status_changed', 'attendance:clocked_in', 'attendance:clocked_out']);
  const empWs = collectEvents(empToken, ['attendance:clocked_in', 'attendance:status_changed']);
  await new Promise((r) => setTimeout(r, 300)); // let sockets connect

  const clockIn = await api('/api/attendance/clock-in', { method: 'POST', token: empToken, retry429: true });
  check('clock-in returns 200 with a server timestamp', clockIn.status === 200 && !!clockIn.json?.data?.record?.clock_in, `status ${clockIn.status}`);
  check('clock-in status is present or late', ['present', 'late'].includes(clockIn.json?.data?.record?.status));

  const empEvents = await empWs;
  const mgrEvents = await mgrWs;
  check('employee WS received attendance:clocked_in', empEvents.seen.has('attendance:clocked_in'));
  check('manager WS received attendance:status_changed (live dashboard)', mgrEvents.seen.has('attendance:status_changed'));

  const dup = await api('/api/attendance/clock-in', { method: 'POST', token: empToken, retry429: true });
  check('duplicate clock-in is rejected', dup.status === 400 && /already clocked in/.test(dup.json?.message || ''), `status ${dup.status}`);

  // ---------------------------------------------------------------------
  section('Employee — breaks & clock out');
  const bs = await api('/api/attendance/break/start', { method: 'POST', token: empToken, retry429: true });
  check('break start returns 200', bs.status === 200 && !!bs.json?.data?.breakId);
  const be = await api('/api/attendance/break/end', { method: 'POST', token: empToken, retry429: true });
  check('break end returns a duration', be.status === 200 && typeof be.json?.data?.durationMinutes === 'number');
  check('break duration is >= 0 minutes', (be.json?.data?.durationMinutes ?? -1) >= 0);

  const clockOut = await api('/api/attendance/clock-out', { method: 'POST', token: empToken, retry429: true });
  check('clock-out returns 200', clockOut.status === 200, `status ${clockOut.status}`);
  const rec = clockOut.json?.data?.record;
  check('clock-out stores server timestamp + total minutes', !!rec?.clock_out && typeof rec?.total_work_minutes === 'number');
  check('total work minutes is a sane duration', rec?.total_work_minutes >= 0);
  check('clock-out status is a known status', ['present', 'late', 'early_leave', 'under_time', 'overtime'].includes(rec?.status));

  const after = await api('/api/attendance/me/today', { token: empToken });
  check('me/today reflects the completed day', after.json?.data?.day?.clock_in && after.json?.data?.day?.clock_out);

  // ---------------------------------------------------------------------
  section('Employee — month calendar & own schedule');
  const month = await api('/api/attendance/me/month?year=2026&month=9', { token: empToken });
  check('me/month returns 30 days', month.json?.data?.days?.length === 30, `got ${month.json?.data?.days?.length}`);
  const todayDay = month.json?.data?.days?.find((d) => d.date === after.json?.data?.day?.date);
  check('today appears in the month with a record', !!todayDay?.clock_in);
  check('month summary carries required minutes', (month.json?.data?.summary?.required_minutes ?? 0) > 0);

  const ownSchedule = await api(`/api/work-schedules/${empId}`, { token: empToken });
  const sched = ownSchedule.json?.data?.schedules || [];
  const monday = sched.find((s) => s.day_of_week === 1);
  check('employee can read their own schedule (7 rows)', sched.length === 7, `got ${sched.length}`);
  check('default Monday is 08:00–17:00 / 480 min', monday?.start_time === '08:00' && monday?.end_time === '17:00' && monday?.required_work_minutes === 480);

  // ---------------------------------------------------------------------
  section('Employee — leave request');
  const leave1 = await api('/api/leave-requests', {
    method: 'POST',
    token: empToken,
    body: { leave_type: 'annual', start_date: '2026-09-28', end_date: '2026-09-29', reason: `${MARKER} annual leave` },
  });
  check('leave request created (pending)', leave1.status === 201 && leave1.json?.data?.leave?.status === 'pending', `status ${leave1.status}`);
  const leaveId = leave1.json?.data?.leave?.id;
  const overlap = await api('/api/leave-requests', {
    method: 'POST',
    token: empToken,
    body: { leave_type: 'sick', start_date: '2026-09-29', end_date: '2026-09-30', reason: `${MARKER} overlap` },
  });
  check('overlapping leave request rejected', overlap.status === 400 && /overlapping/.test(overlap.json?.message || ''));

  // ---------------------------------------------------------------------
  section('Employee — overtime request (pending)');
  const otReq = await api('/api/overtime', {
    method: 'POST',
    token: empToken,
    body: { date: '2026-09-02', minutes: 90, reason: `${MARKER} project crunch` },
  });
  check('overtime request created (pending)', otReq.status === 201 && otReq.json?.data?.overtime?.status === 'pending', `status ${otReq.status}`);
  const overtimeId = otReq.json?.data?.overtime?.id;

  // ---------------------------------------------------------------------
  section('Manager — dashboard, table & report');
  const dash = await api('/api/attendance/dashboard', { token: mgrToken });
  check('dashboard returns 200', dash.status === 200, `status ${dash.status}`);
  check('dashboard counts employees', (dash.json?.data?.dashboard?.total_employees ?? 0) > 0);
  const presentish = (dash.json?.data?.dashboard?.present ?? 0) + (dash.json?.data?.dashboard?.late ?? 0);
  check('employee appears as present/late after clocking in', presentish >= 1, `present=${dash.json?.data?.dashboard?.present} late=${dash.json?.data?.dashboard?.late}`);

  const employees = await api('/api/attendance/employees?year=2026&month=9', { token: mgrToken });
  const rows = employees.json?.data?.employees || [];
  const mayaRow = rows.find((r) => r.employee_id === empId);
  check('employee×day table includes maya', !!mayaRow, `rows ${rows.length}`);
  check('maya row has 30 day cells', mayaRow?.days?.length === 30);
  check('maya row day shows a record for today', mayaRow?.days?.some((d) => d.clock_in));

  const filtered = await api('/api/attendance/employees?year=2026&month=9&status=late', { token: mgrToken });
  check('status filter is accepted', filtered.status === 200, `status ${filtered.status}`);

  const detail = await api(`/api/attendance/employee/${empId}?year=2026&month=9`, { token: mgrToken });
  check('employee detail drill-down returns 200 with 30 days', detail.status === 200 && detail.json?.data?.days?.length === 30);

  const report = await api('/api/attendance/report?year=2026&month=9', { token: mgrToken });
  check('monthly report returns 200', report.status === 200 && Array.isArray(report.json?.data?.report));
  check('report contains maya with a summary', report.json?.data?.report?.some((r) => r.employee_id === empId && typeof r.attendance_rate === 'number'));

  // ---------------------------------------------------------------------
  section('Manager — work schedule customization');
  const allSchedules = await api('/api/work-schedules', { token: mgrToken });
  check('manager lists all schedules', allSchedules.status === 200 && (allSchedules.json?.data?.schedules || []).length > 0);
  const edit = await api('/api/work-schedules', {
    method: 'POST',
    token: mgrToken,
    body: { employee_id: empId, day_of_week: 1, start_time: '09:00', end_time: '17:00', break_minutes: 60, required_work_minutes: 480, is_working_day: 1 },
  });
  check('manager upserts Monday 09:00 start', edit.status === 201 && edit.json?.data?.schedule?.start_time === '09:00', `status ${edit.status}`);
  const revert = await api('/api/work-schedules', {
    method: 'POST',
    token: mgrToken,
    body: { employee_id: empId, day_of_week: 1, start_time: '08:00', end_time: '17:00', break_minutes: 60, required_work_minutes: 480, is_working_day: 1 },
  });
  check('manager reverts Monday to 08:00', revert.status === 201 && revert.json?.data?.schedule?.start_time === '08:00');

  // ---------------------------------------------------------------------
  section('Manager — leave approval reflects in the employee calendar');
  const approve = await api(`/api/leave-requests/${leaveId}/approve`, { method: 'PUT', token: mgrToken });
  check('manager approves the leave request', approve.status === 200 && approve.json?.data?.leave?.status === 'approved', `status ${approve.status}`);
  const empMonth = await api('/api/attendance/me/month?year=2026&month=9', { token: empToken });
  const sep28 = empMonth.json?.data?.days?.find((d) => d.date === '2026-09-28');
  check('approved leave shows as leave (not absence) in the calendar', sep28?.status === 'leave', `status ${sep28?.status}`);

  // ---------------------------------------------------------------------
  section('Manager — holiday CRUD');
  const holidayCreate = await api('/api/holidays', {
    method: 'POST',
    token: mgrToken,
    body: { name: `E2E Holiday ${MARKER}`, date: '2026-09-25', description: 'e2e' },
  });
  check('manager creates a holiday', holidayCreate.status === 201, `status ${holidayCreate.status}`);
  const holidayId = holidayCreate.json?.data?.holiday?.id;
  const holidaysList = await api('/api/holidays', { token: mgrToken });
  check('holiday list contains it', holidaysList.json?.data?.holidays?.some((h) => h.id === holidayId));
  const holidayUpdate = await api(`/api/holidays/${holidayId}`, {
    method: 'PUT',
    token: mgrToken,
    body: { name: `E2E Holiday Updated ${MARKER}` },
  });
  check('manager updates a holiday', holidayUpdate.status === 200 && /Updated/.test(holidayUpdate.json?.data?.holiday?.name || ''));
  const empMonth2 = await api('/api/attendance/me/month?year=2026&month=9', { token: empToken });
  const sep25 = empMonth2.json?.data?.days?.find((d) => d.date === '2026-09-25');
  check('holiday overrides the calendar day', sep25?.status === 'holiday' && sep25?.required_work_minutes === 0, `status ${sep25?.status}`);
  const holidayDelete = await api(`/api/holidays/${holidayId}`, { method: 'DELETE', token: mgrToken });
  check('manager deletes a holiday', holidayDelete.status === 200);

  // ---------------------------------------------------------------------
  section('Manager — overtime approval');
  const otApprove = await api(`/api/overtime/${overtimeId}/approve`, { method: 'PUT', token: mgrToken });
  check('manager approves the overtime request', otApprove.status === 200 && otApprove.json?.data?.overtime?.status === 'approved', `status ${otApprove.status}`);
  const otList = await api('/api/overtime', { token: mgrToken });
  check('manager lists overtime requests', otList.status === 200 && otList.json?.data?.overtime?.some((o) => o.id === overtimeId));

  // ---------------------------------------------------------------------
  section('Permissions — employees are scoped');
  const empHoliday = await api('/api/holidays', { method: 'POST', token: empToken, body: { name: 'x', date: '2026-12-01' } });
  check('employee cannot create holidays (403)', empHoliday.status === 403, `status ${empHoliday.status}`);
  const empApprove = await api(`/api/leave-requests/${leaveId}/approve`, { method: 'PUT', token: empToken });
  check('employee cannot approve leave (403)', empApprove.status === 403, `status ${empApprove.status}`);
  const empDashboard = await api('/api/attendance/dashboard', { token: empToken });
  check('employee cannot read the dashboard (403)', empDashboard.status === 403, `status ${empDashboard.status}`);
  const empSchedules = await api('/api/work-schedules', { token: empToken });
  check('employee cannot list all schedules (403)', empSchedules.status === 403, `status ${empSchedules.status}`);
  const empOtApprove = await api(`/api/overtime/${overtimeId}/approve`, { method: 'PUT', token: empToken });
  check('employee cannot approve overtime (403)', empOtApprove.status === 403, `status ${empOtApprove.status}`);

  // ---------------------------------------------------------------------
  console.log(`\n${'═'.repeat(60)}`);
  if (failed === 0) {
    console.log(`🎉 ALL ATTENDANCE CHECKS PASSED (${passed} checks)`);
  } else {
    console.log(`❌ ${failed} check(s) failed, ${passed} passed`);
  }
}

async function cleanup() {
  try {
    const connection = require('../dist/src/database/connection');
    const db = connection.default || connection;
    const breaks = await db.query(
      `SELECT b.id FROM break_records b
       JOIN attendance_records a ON a.id = b.attendance_id
       WHERE a.employee_id = ? AND a.date = CURDATE()`,
      [3],
    );
    if (breaks.length) {
      await db.query('DELETE FROM break_records WHERE id IN (?)', [breaks.map((b) => b.id)]);
    }
    await db.query('DELETE FROM attendance_records WHERE employee_id = ? AND date = CURDATE()', [3]);
    await db.query('DELETE FROM overtime_records WHERE reason LIKE ?', ['att-%']);
    await db.query('DELETE FROM leave_requests WHERE reason LIKE ?', ['att-%']);
    await db.query('DELETE FROM holidays WHERE name LIKE ?', ['E2E Holiday %']);
    // Restore maya's Monday schedule in case a partial run left it at 09:00.
    await db.query(
      `UPDATE work_schedules SET start_time = '08:00', end_time = '17:00', updated_at = updated_at
       WHERE employee_id = 3 AND day_of_week = 1`,
    );
    await db.pool.end().catch(() => {});
    console.log('  🧹 Cleaned up all attendance test rows');
  } catch (error) {
    console.warn(`  ⚠  SQL cleanup skipped: ${error.message}`);
  }
}

main()
  .catch((error) => {
    console.error('\n❌ E2E script error:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    process.exit(process.exitCode || (passed > 0 && failed === 0 ? 0 : 1));
  });