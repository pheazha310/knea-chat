#!/usr/bin/env node
/**
 * KneaChat — Tasks & notification preferences end-to-end check (no browser).
 *
 * Exercises the two modules added for the Notifications outline:
 *
 *   maya (employee)      → reads her preferences, toggles categories, sees
 *                          tasks assigned to her, completes them.
 *   dara (manager)       → assigns tasks (notifications respect maya's
 *                          preference toggles), role scoping for deletes.
 *   SQL                  → asserts task_assigned notification rows.
 *
 * Leaves a clean database behind (marker-based cleanup).
 *
 * Requirements: a running backend (:8080) with seeded demo users and the
 * tasks + user_notification_preferences tables (migration 020).
 *
 * Usage:
 *   npm run test:e2e:tasks
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const API_BASE = process.env.API_BASE || 'http://localhost:8080';
const PASSWORD = process.env.E2E_PASSWORD || 'kneachat168';
const MARKER = `tst-${process.pid}-${Date.now().toString(36)}`;

const MAYAS_EMAIL = 'maya@kneachat.com'; // employee
const DARAS_EMAIL = 'dara@kneachat.com'; // manager

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

async function api(pathname, { method = 'GET', token, body } = {}) {
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
  return { status: res.status, json };
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

async function main() {
  console.log('KneaChat E2E — tasks & notification preferences');
  console.log(`  API : ${API_BASE}`);
  console.log(`  mark: ${MARKER}`);

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
  const maya = await login(MAYAS_EMAIL);
  const dara = await login(DARAS_EMAIL);
  const mayaId = maya.user.id;
  const mayaToken = maya.token;
  const daraToken = dara.token;
  check(`maya logged in (id ${mayaId})`, !!mayaToken);
  check(`dara logged in (id ${dara.user.id})`, !!daraToken);

  // A second employee (id 4 in the seed) so assignment role rules can be
  // tested against a task maya does not own.
  let otherId = null;
  try {
    const connection = require('../dist/src/database/connection');
    const db = connection.default || connection;
    const rows = await db.query(
      `SELECT id FROM users WHERE company_id = ? AND role = 'employee' AND id <> ? LIMIT 1`,
      [maya.user.company_id, mayaId],
    );
    otherId = rows[0]?.id || null;
  } catch (error) {
    console.warn(`  ⚠  SQL skipped: ${error.message}`);
  }

  // ---------------------------------------------------- notification prefs
  section('Notification preferences');
  const prefsBefore = await api('/api/notification-preferences', { token: mayaToken });
  const all = prefsBefore.json?.data?.preferences || [];
  check('maya reads 7 categories, all enabled by default', all.length === 7 && all.every((p) => p.enabled), `got ${all.length}`);

  const muted = await api('/api/notification-preferences', {
    method: 'PUT',
    token: mayaToken,
    body: { category: 'messages', enabled: false },
  });
  check('maya mutes new messages', muted.status === 200 && muted.json?.data?.preference?.enabled === false, `status ${muted.status}`);
  const prefsAfter = await api('/api/notification-preferences', { token: mayaToken });
  check('muted category reflected in the list', prefsAfter.json?.data?.preferences?.find((p) => p.category === 'messages')?.enabled === false);

  const unmuted = await api('/api/notification-preferences', {
    method: 'PUT',
    token: mayaToken,
    body: { category: 'messages', enabled: true },
  });
  check('maya re-enables new messages', unmuted.status === 200 && unmuted.json?.data?.preference?.enabled === true, `status ${unmuted.status}`);

  const badPref = await api('/api/notification-preferences', {
    method: 'PUT',
    token: mayaToken,
    body: { category: 'telepathy', enabled: false },
  });
  check('unknown category rejected', badPref.status === 400 && /Unknown notification category/.test(badPref.json?.message || ''), `status ${badPref.status}`);

  // ------------------------------------------------------ task assignment
  section('Tasks — assignment & notifications');
  // 1. maya has muted 'tasks': dara assigns → no notification row.
  await api('/api/notification-preferences', {
    method: 'PUT',
    token: mayaToken,
    body: { category: 'tasks', enabled: false },
  });
  const quietAssign = await api('/api/tasks', {
    method: 'POST',
    token: daraToken,
    body: {
      title: `${MARKER} quiet`,
      description: 'Assigned while tasks are muted',
      assignee_id: mayaId,
      due_date: '2099-01-01',
      priority: 'medium',
    },
  });
  check('manager assigns a task (201)', quietAssign.status === 201 && !!quietAssign.json?.data?.task, `status ${quietAssign.status}`);
  const quietTaskId = quietAssign.json?.data?.task?.id;

  let quietNotifCount = -1;
  try {
    const connection = require('../dist/src/database/connection');
    const db = connection.default || connection;
    const rows = await db.query(
      `SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'task_assigned' AND data LIKE ?`,
      [mayaId, `%${quietTaskId}%`],
    );
    quietNotifCount = Number(rows[0]?.total || 0);
  } catch (error) {
    console.warn(`  ⚠  SQL skipped: ${error.message}`);
  }
  check('no assignment notification when the assignee muted tasks', quietNotifCount === 0, `rows ${quietNotifCount}`);

  // 2. maya re-enables tasks → next assignment notifies.
  await api('/api/notification-preferences', {
    method: 'PUT',
    token: mayaToken,
    body: { category: 'tasks', enabled: true },
  });
  const loudAssign = await api('/api/tasks', {
    method: 'POST',
    token: daraToken,
    body: {
      title: `${MARKER} loud`,
      description: 'Assigned with tasks enabled',
      assignee_id: mayaId,
      due_date: '2099-01-02',
      priority: 'high',
    },
  });
  check('second task assigned (201)', loudAssign.status === 201, `status ${loudAssign.status}`);
  const loudTaskId = loudAssign.json?.data?.task?.id;

  let loudNotifCount = -1;
  try {
    const connection = require('../dist/src/database/connection');
    const db = connection.default || connection;
    const rows = await db.query(
      `SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'task_assigned' AND data LIKE ?`,
      [mayaId, `%${loudTaskId}%`],
    );
    loudNotifCount = Number(rows[0]?.total || 0);
  } catch (error) {
    console.warn(`  ⚠  SQL skipped: ${error.message}`);
  }
  check('assignment notification created when tasks are enabled', loudNotifCount === 1, `rows ${loudNotifCount}`);

  // ------------------------------------------------------------- task list
  section('Tasks — role scoping & status');
  const mayaTasks = await api('/api/tasks', { token: mayaToken });
  const mayaTaskTitles = (mayaTasks.json?.data?.tasks || []).map((t) => t.title);
  check('maya lists tasks assigned to her', mayaTaskTitles.includes(`${MARKER} loud`) && mayaTaskTitles.includes(`${MARKER} quiet`), `got ${mayaTaskTitles.length}`);

  const empAssign = await api('/api/tasks', {
    method: 'POST',
    token: mayaToken,
    body: { title: `${MARKER} illegal`, assignee_id: dara.user.id, due_date: '2099-01-03' },
  });
  check('employee cannot assign a task to a manager (400)', empAssign.status === 400 && /Only managers can assign/.test(empAssign.json?.message || ''), `status ${empAssign.status} — ${empAssign.json?.message}`);

  const complete = await api(`/api/tasks/${loudTaskId}`, {
    method: 'PATCH',
    token: mayaToken,
    body: { status: 'completed' },
  });
  check('assignee can complete their task', complete.status === 200 && complete.json?.data?.task?.status === 'completed', `status ${complete.status}`);

  const filterDone = await api('/api/tasks?status=completed', { token: mayaToken });
  check('status filter returns completed tasks', (filterDone.json?.data?.tasks || []).some((t) => t.id === loudTaskId));

  let managerTaskId = null;
  if (otherId) {
    const forOther = await api('/api/tasks', {
      method: 'POST',
      token: daraToken,
      body: { title: `${MARKER} other`, assignee_id: otherId, due_date: '2099-01-04' },
    });
    managerTaskId = forOther.json?.data?.task?.id;
    const strangerEdit = await api(`/api/tasks/${managerTaskId}`, {
      method: 'PATCH',
      token: mayaToken,
      body: { status: 'open' },
    });
    check('unrelated employee cannot touch another\u2019s task (400)', strangerEdit.status === 400, `status ${strangerEdit.status}`);
  } else {
    check('unrelated employee cannot touch another\u2019s task (400)', false, 'no other employee available');
  }

  const illegalDelete = await api(`/api/tasks/${quietTaskId}`, { method: 'DELETE', token: mayaToken });
  check('assignee cannot delete a task they did not create (400)', illegalDelete.status === 400, `status ${illegalDelete.status}`);

  // Overdue flag: quiet task due 2099 is fine; force an overdue marker task.
  const overdue = await api('/api/tasks', {
    method: 'POST',
    token: daraToken,
    body: { title: `${MARKER} overdue`, assignee_id: mayaId, due_date: '2020-01-01' },
  });
  check('manager creates an already-overdue task', overdue.status === 201, `status ${overdue.status}`);
  const overdueList = await api('/api/tasks?search=overdue', { token: mayaToken });
  check('overdue task flagged in the list', (overdueList.json?.data?.tasks || []).some((t) => t.is_overdue === true && t.title === `${MARKER} overdue`));

  console.log(`\n${'═'.repeat(60)}`);
  if (failed === 0) {
    console.log(`🎉 ALL TASKS & PREFERENCES CHECKS PASSED (${passed} checks)`);
  } else {
    console.log(`❌ ${failed} check(s) failed, ${passed} passed`);
  }
}

async function cleanup() {
  try {
    const connection = require('../dist/src/database/connection');
    const db = connection.default || connection;
    await db.query('DELETE FROM notifications WHERE title LIKE ? OR message LIKE ?', [`%${MARKER}%`, `%${MARKER}%`]);
    await db.query('DELETE FROM tasks WHERE title LIKE ?', [`${MARKER}%`]);
    // Restore maya's preferences to defaults.
    await db.query('DELETE FROM user_notification_preferences WHERE user_id = 3');
    await db.pool.end().catch(() => {});
    console.log('  🧹 Cleaned up all task/preference test rows');
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
