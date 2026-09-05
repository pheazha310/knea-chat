#!/usr/bin/env node
/**
 * KneaChat — End-to-end login history & session management check (no browser).
 *
 * Security checklist item 11:
 *   - every sign-in is recorded with device + IP + time
 *   - users can read their login history (active / expired / signed out)
 *   - "sign out all other devices" keeps only the current session
 *   - logout is a SOFT sign-out — the history rows are preserved
 *   - admins can view any workspace user's history; employees get 403
 *   - the platform "active sessions" metric excludes signed-out sessions
 *
 * Requirements: a running backend (:8080) with the seeded demo users and the
 * migration 024 column (logged_out_at) applied.
 *
 * Usage:
 *   npm run test:e2e:sessions
 *   API_BASE=http://host:8080 npm run test:e2e:sessions
 *
 * Exit code 0 = every check behaved as expected. Only the sessions created by
 * this run are cleaned up; the demo data is left untouched.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const API_BASE = process.env.API_BASE || 'http://localhost:8080';
const PASSWORD = process.env.E2E_PASSWORD || 'kneachat168';

const EMPLOYEE = { email: 'maya@kneachat.com', name: 'maya' };
const ADMIN = { email: 'admin@kneachat.com', name: 'admin' };

const UA_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const UA_FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0';

// ---------------------------------------------------------------------------
// Tiny harness (same style as permissions.e2e.js)
// ---------------------------------------------------------------------------
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

async function api(pathname, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
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

async function login(email, userAgent) {
  const { status, json } = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password: PASSWORD },
    headers: userAgent ? { 'User-Agent': userAgent } : {},
  });
  if (status !== 200 || !json?.data?.token) {
    throw new Error(`Login failed for ${email} (HTTP ${status}): ${JSON.stringify(json)}`);
  }
  return json.data;
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------
const createdSessionIds = [];

async function main() {
  console.log('KneaChat E2E — login history & session management');
  console.log(`  API : ${API_BASE}`);

  // 0. Preflight.
  section('Preflight');
  let health;
  try {
    health = await api('/api/health');
  } catch {
    health = { status: 0 };
  }
  if (health.status !== 200) {
    console.log('  ❌ Cannot reach KneaChat API. Start the backend first: cd server && npm run dev');
    process.exit(1);
  }
  console.log('  ✅ Server is up');

  // 1. Sign in twice from two different devices.
  section('Sign-in recording');
  const a = await login(EMPLOYEE.email, UA_CHROME); // first device
  const b = await login(EMPLOYEE.email, UA_FIREFOX); // second device
  check('employee can sign in', !!a.token && !!b.token);

  // 2. Login history shows both sessions as active (newest first).
  section('Login history (own)');
  const hist1 = await api('/api/auth/sessions', { token: b.token });
  check('GET /api/auth/sessions → 200', hist1.status === 200, `got ${hist1.status}`);
  const list1 = hist1.json?.data?.sessions || [];
  check('both sign-ins are recorded', list1.length >= 2, `${list1.length} row(s)`);
  const top1 = list1[0];
  check('most recent sign-in is active', top1?.status === 'active', top1?.device_info || '');
  check('sessions expose IP but never token hashes', top1?.ip_address != null && top1?.token_hash === undefined);
  createdSessionIds.push(...list1.slice(0, 2).map((s) => s.id));
  const firstDevice = list1.find((s) => /Chrome/.test(s.device_info || ''));
  const secondDevice = list1.find((s) => /Firefox/.test(s.device_info || ''));
  check('Chrome session present and active', firstDevice?.status === 'active');
  check('Firefox session present and active', secondDevice?.status === 'active');

  // 3. Sign out all other devices — Firefox (current) survives, Chrome dies.
  section('Sign out all other devices');
  const revoke = await api('/api/auth/sessions/revoke-others', { method: 'POST', token: b.token });
  check('POST revoke-others → 200', revoke.status === 200, `got ${revoke.status}`);
  check('at least one other session revoked', (revoke.json?.data?.revoked || 0) >= 1, `revoked=${revoke.json?.data?.revoked}`);
  const hist2 = await api('/api/auth/sessions', { token: b.token });
  const list2 = hist2.json?.data?.sessions || [];
  const chromeAfter = list2.find((s) => s.id === firstDevice.id);
  const firefoxAfter = list2.find((s) => s.id === secondDevice.id);
  check('Chrome session now signed out', chromeAfter?.status === 'logged_out');
  check('current Firefox session still active', firefoxAfter?.status === 'active');

  // 4. Logout is soft — history rows survive, marked signed out.
  section('Soft logout');
  const logout = await api('/api/auth/logout', { method: 'POST', token: b.token });
  check('POST /api/auth/logout → 200', logout.status === 200, `got ${logout.status}`);
  const { status: loginAgainStatus, json: loginAgain } = await api('/api/auth/login', {
    method: 'POST',
    body: { email: EMPLOYEE.email, password: PASSWORD },
    headers: { 'User-Agent': UA_CHROME },
  });
  check('can sign back in after logout', loginAgainStatus === 200);
  const c = loginAgain.data;
  const hist3 = await api('/api/auth/sessions', { token: c.token });
  const list3 = hist3.json?.data?.sessions || [];
  const firefoxAfterLogout = list3.find((s) => s.id === secondDevice.id);
  check('logged-out session row is preserved (not deleted)', firefoxAfterLogout != null);
  check('logged-out session row marked signed out', firefoxAfterLogout?.status === 'logged_out');
  // Rows created within the same second share a DATETIME, so find the new
  // sign-in by identity (active Chrome row) instead of list position.
  const newRow = list3.find((s) => s.status === 'active' && /Chrome/.test(s.device_info || ''));
  check('new sign-in is recorded as an active session', newRow != null && newRow.id !== firstDevice.id);
  createdSessionIds.push(newRow.id);

  // 5. RBAC on the admin endpoint.
  section('Admin view (data access control)');
  const admin = await login(ADMIN.email);
  const mayaId = a.user.id;
  const adminView = await api(`/api/users/${mayaId}/sessions`, { token: admin.token });
  check('admin can view a user’s login history → 200', adminView.status === 200, `got ${adminView.status}`);
  const adminList = adminView.json?.data?.sessions || [];
  check('admin history includes this run’s sign-ins', adminList.some((s) => s.id === firstDevice.id) && adminList.some((s) => s.id === newRow.id));
  check('admin view also excludes token hashes', (adminList[0] || {}).token_hash === undefined);
  const employeeView = await api(`/api/users/${mayaId}/sessions`, { token: c.token });
  check('employee is blocked from viewing others’ history → 403', employeeView.status === 403, `got ${employeeView.status}`);

  // 6. Platform metric counts only live sessions (super-admin endpoint).
  section('Active sessions metric');
  const superAdmin = await login('super@kneachat.com');
  const metrics = await api('/api/admin/metrics', { token: superAdmin.token });
  check('GET /api/admin/metrics → 200', metrics.status === 200, `got ${metrics.status}`);
  const apiActive = metrics.json?.data?.metrics?.totals?.active_sessions;
  check('metric endpoint returns active_sessions', typeof apiActive === 'number', String(apiActive));
  try {
    const connection = require('../dist/src/database/connection');
    const db = connection.default || connection;
    const rows = await db.query(
      'SELECT COUNT(*) AS active FROM user_sessions WHERE logged_out_at IS NULL AND expires_at > NOW()',
    );
    const dbActive = Number(rows[0]?.active || 0);
    check('metric matches DB (excludes signed-out sessions)', apiActive === dbActive, `api=${apiActive} db=${dbActive}`);
    // Pool stays open — cleanup() uses the same singleton.
  } catch (error) {
    check('DB cross-check', false, error.message);
  }

  // Summary.
  section('Result');
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Cleanup — delete only the session rows this run created (API has no DELETE).
// ---------------------------------------------------------------------------
async function cleanup() {
  if (!createdSessionIds.length) return;
  try {
    const connection = require('../dist/src/database/connection');
    const db = connection.default || connection;
    await db.query('DELETE FROM user_sessions WHERE id IN (?)', [createdSessionIds]);
    await db.pool.end().catch(() => {});
    console.log(`  🧹 Cleaned up ${createdSessionIds.length} session row(s) created by this run`);
  } catch (error) {
    console.warn(`  ⚠  SQL cleanup skipped: ${error.message}`);
  }
}

main()
  .catch((error) => {
    console.error('\n❌ E2E script error:', error.message);
    process.exitCode = 1;
  })
  .finally(cleanup);