#!/usr/bin/env node
/**
 * KneaChat — End-to-end permission matrix check (no browser).
 *
 * Verifies every row of the role matrix against the live REST API:
 *
 *   Feature                  Super Admin  Company Admin  Manager  Employee
 *   Platform settings        ✓            ✗              ✗        ✗
 *   Manage companies         ✓            ✗              ✗        ✗
 *   Manage employees         ✓            ✓              Limited  ✗
 *   Manage roles             ✓            ✓              ✗        ✗
 *   Create teams             ✓            ✓              ✓        ✗
 *   Manage team members      ✓            ✓              ✓*       ✗*
 *   Create channels          ✓            ✓              ✓*       ✓ (own teams)
 *   Send / edit own / delete
 *     own / react / search   ✓            ✓              ✓        ✓
 *   View / update profile    ✓            ✓              ✓        ✓
 *
 *   * managers only in the teams they are assigned to; team creators may
 *     add/remove members of their own team.
 *
 * Logs in as all four seeded roles and asserts the HTTP status each action
 * produces. Creates throwaway users/teams/channels/conversation and removes
 * them (API + marker-based SQL) so the demo data is left untouched.
 *
 * Requirements: a running backend (:8080) with the seeded demo users.
 *
 * Usage:
 *   npm run test:e2e:permissions
 *   API_BASE=http://host:8080 npm run test:e2e:permissions
 *
 * Exit code 0 = every matrix cell behaved as expected.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const API_BASE = process.env.API_BASE || 'http://localhost:8080';
const PASSWORD = process.env.E2E_PASSWORD || 'kneachat168';
const MARKER = `perm-${process.pid}-${Date.now().toString(36)}`;

const ACCOUNTS = {
  super: { email: 'super@kneachat.com', role: 'super_admin' },
  admin: { email: 'admin@kneachat.com', role: 'admin' },
  dara: { email: 'dara@kneachat.com', role: 'manager' },
  maya: { email: 'maya@kneachat.com', role: 'employee' },
};

// ---------------------------------------------------------------------------
// Tiny harness (same style as notifications.e2e.js)
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

/** Assert an HTTP status; returns the response for follow-up use. */
async function expectStatus(res, expected, label) {
  const ok = res.status === expected;
  check(label, ok, `expected ${expected}, got ${res.status}`);
  return res;
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

// ---------------------------------------------------------------------------
// State created during the run (cleaned up at the end)
// ---------------------------------------------------------------------------
const state = {
  createdUserIds: [],
  createdTeamIds: [],
  createdChannelIds: [],
  createdConversationId: null,
  addedMembers: [], // { teamId, memberId } — removed via API
  messageIds: {}, // role -> message id
  removedRoles: [], // { userId, role } — restored via API
};

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------
async function main() {
  console.log('KneaChat E2E — role permission matrix');
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

  // 1. Authenticate every role.
  section('Authentication');
  const sessions = {};
  for (const [key, acc] of Object.entries(ACCOUNTS)) {
    sessions[key] = await login(acc.email);
    check(`${acc.role} logged in (${acc.email}, id ${sessions[key].user?.id})`, !!sessions[key].token);
  }
  const ids = Object.fromEntries(Object.entries(ACCOUNTS).map(([k, a]) => [k, sessions[k].user.id]));
  const token = (key) => sessions[key].token;

  // 2. Resolve the seeded teams we use for scoped checks.
  section('Setup: seeded teams');
  const teamsRes = await api('/api/teams', { token: token('admin') });
  const teams = (teamsRes.json?.data?.teams || []).reduce((map, t) => {
    map[t.name] = t.id;
    return map;
  }, {});
  const peId = teams['Product Engineering'];
  const dgId = teams['Design Guild'];
  check('seeded team "Product Engineering" resolved', Number.isInteger(peId));
  check('seeded team "Design Guild" resolved', Number.isInteger(dgId));
  if (!peId || !dgId) throw new Error('Seeded teams missing — run npm run db:seed');

  // A throwaway team nobody (other than the admin who created it) is a member
  // of — used for the "unassigned manager / non-member employee" channel checks.
  const otherRes = await api('/api/teams', {
    method: 'POST',
    token: token('admin'),
    body: { name: `other-team-${MARKER}` },
  });
  const otherTeamId = Number(otherRes.json?.data?.team?.id);
  check('throwaway "other" team resolved (id ' + otherTeamId + ')', Number.isInteger(otherTeamId) && otherTeamId > 0);
  if (Number.isInteger(otherTeamId) && otherTeamId > 0) state.createdTeamIds.push(otherTeamId);

  // 3. A dedicated group conversation for the messaging rows (all 4 roles).
  section('Setup: test conversation');
  const convRes = await api('/api/conversations', {
    method: 'POST',
    token: token('admin'),
    body: {
      type: 'group',
      name: `Permission check ${MARKER}`,
      description: 'e2e permission matrix conversation',
      participant_ids: [ids.super, ids.dara, ids.maya],
    },
  });
  const convId = Number(convRes.json?.data?.conversation?.id);
  state.createdConversationId = convId;
  check('test group conversation created (id ' + convId + ')', Number.isInteger(convId) && convId > 0);
  if (!Number.isInteger(convId)) throw new Error('Could not create test conversation');

  // ---------------------------------------------------------------------
  section('Platform settings — Super Admin only');
  await expectStatus(await api('/api/settings', { token: token('super') }), 200, 'Super Admin reads platform settings');
  for (const k of ['admin', 'dara', 'maya']) {
    await expectStatus(await api('/api/settings', { token: token(k) }), 403, `${ACCOUNTS[k].role} is blocked from platform settings`);
  }

  // ---------------------------------------------------------------------
  section('Manage companies — Super Admin only');
  await expectStatus(await api('/api/companies', { token: token('super') }), 200, 'Super Admin lists companies');
  await expectStatus(await api('/api/companies', { token: token('admin') }), 403, 'Company Admin is blocked from managing companies');

  // ---------------------------------------------------------------------
  section('Manage employees — admins only (managers: limited = view only)');
  const mkUser = (prefix) => ({
    first_name: `${prefix} First`,
    last_name: `${prefix} Last`,
    email: `${prefix.toLowerCase()}-${MARKER}@example.com`,
    password: PASSWORD,
    role: 'employee',
  });
  const adminMade = await api('/api/users', { method: 'POST', token: token('admin'), body: mkUser('A') });
  await expectStatus(adminMade, 201, 'Company Admin creates an employee');
  state.createdUserIds.push(adminMade.json?.data?.user?.id);

  const superMade = await api('/api/users', { method: 'POST', token: token('super'), body: mkUser('S') });
  await expectStatus(superMade, 201, 'Super Admin creates an employee');
  state.createdUserIds.push(superMade.json?.data?.user?.id);

  await expectStatus(await api('/api/users', { method: 'POST', token: token('dara'), body: mkUser('M') }), 403, 'Manager cannot create employees (403)');
  await expectStatus(await api('/api/users', { method: 'POST', token: token('maya'), body: mkUser('E') }), 403, 'Employee cannot create employees (403)');

  // Managers CAN view the directory (the "Limited" cell).
  await expectStatus(await api('/api/users', { token: token('dara') }), 200, 'Manager can view the employee directory (limited)');

  // ---------------------------------------------------------------------
  section('Manage roles — admins only; only Super Admin assigns super_admin');
  const u2 = superMade.json?.data?.user?.id;
  await expectStatus(await api(`/api/users/${u2}`, { method: 'PATCH', token: token('admin'), body: { role: 'manager' } }), 200, 'Company Admin changes a role');
  await expectStatus(await api(`/api/users/${u2}`, { method: 'PATCH', token: token('dara'), body: { role: 'employee' } }), 400, 'Manager cannot change roles');
  await expectStatus(await api(`/api/users/${u2}`, { method: 'PATCH', token: token('maya'), body: { role: 'employee' } }), 400, 'Employee cannot change roles');
  await expectStatus(await api(`/api/users/${u2}`, { method: 'PATCH', token: token('admin'), body: { role: 'super_admin' } }), 400, 'Company Admin cannot assign super_admin');
  await expectStatus(await api(`/api/users/${u2}`, { method: 'PATCH', token: token('super'), body: { role: 'super_admin' } }), 200, 'Super Admin assigns super_admin');
  // Restore so the account is deletable by a Company Admin during cleanup.
  await expectStatus(await api(`/api/users/${u2}`, { method: 'PATCH', token: token('super'), body: { role: 'employee' } }), 200, 'Super Admin restores role');

  // ---------------------------------------------------------------------
  section('Create teams — manager+');
  await expectStatus(await api('/api/teams', { method: 'POST', token: token('maya'), body: { name: `x ${MARKER}` } }), 403, 'Employee cannot create a team (403)');
  for (const k of ['super', 'admin', 'dara']) {
    const res = await api('/api/teams', { method: 'POST', token: token(k), body: { name: `${k}-team-${MARKER}` } });
    await expectStatus(res, 201, `${ACCOUNTS[k].role} creates a team`);
    state.createdTeamIds.push(res.json?.data?.team?.id);
  }

  // ---------------------------------------------------------------------
  section('Manage team members — manager+ (assigned) or the team creator');
  // dara (manager) is a member of Product Engineering, not Design Guild.
  const addMember = (teamId, userId, k) =>
    api(`/api/teams/${teamId}/members`, { method: 'POST', token: token(k), body: { user_id: userId } });
  const r1 = await addMember(peId, ids.admin, 'dara');
  await expectStatus(r1, 201, 'Manager adds a member to an assigned team');
  state.addedMembers.push({ teamId: peId, memberId: ids.admin, deleter: 'dara' });
  await expectStatus(await addMember(dgId, ids.admin, 'dara'), 400, 'Manager cannot add to an unassigned team');
  await expectStatus(await addMember(peId, ids.admin, 'maya'), 400, 'Employee cannot add team members');
  const r2 = await addMember(dgId, ids.maya, 'admin');
  await expectStatus(r2, 201, 'Company Admin adds a member to any team');
  state.addedMembers.push({ teamId: dgId, memberId: ids.maya, deleter: 'admin' });

  // ---------------------------------------------------------------------
  section('Create channels — managers (assigned) & employees (their teams)');
  const mkChannel = (extra, k) => api('/api/channels', { method: 'POST', token: token(k), body: { name: `${MARKER}-${Math.random().toString(36).slice(2, 7)}`, type: 'public', ...extra } });
  const c1 = await mkChannel({}, 'admin');
  await expectStatus(c1, 201, 'Company Admin creates a standalone channel');
  state.createdChannelIds.push(c1.json?.data?.channel?.id);
  const c2 = await mkChannel({ team_id: peId }, 'dara');
  await expectStatus(c2, 201, 'Manager creates a channel in an assigned team');
  state.createdChannelIds.push(c2.json?.data?.channel?.id);
  await expectStatus(await mkChannel({ team_id: otherTeamId }, 'dara'), 400, 'Manager cannot create in an unassigned team');
  const c3 = await mkChannel({ team_id: peId }, 'maya');
  await expectStatus(c3, 201, 'Employee creates a channel in a team they belong to');
  state.createdChannelIds.push(c3.json?.data?.channel?.id);
  await expectStatus(await mkChannel({}, 'maya'), 400, 'Employee cannot create a standalone channel');
  await expectStatus(await mkChannel({ team_id: otherTeamId }, 'maya'), 400, 'Employee cannot create in a team they are not in');

  // ---------------------------------------------------------------------
  section('Messaging — every role can send / react / search; only own edit+delete');
  const sendMsg = async (k) => {
    const res = await api('/api/messages', {
      method: 'POST',
      token: token(k),
      body: { conversation_id: convId, content: `${MARKER} from ${ACCOUNTS[k].role}` },
    });
    await expectStatus(res, 201, `${ACCOUNTS[k].role} sends a message`);
    state.messageIds[k] = res.json?.data?.message?.id;
  };
  for (const k of ['super', 'admin', 'dara', 'maya']) await sendMsg(k);

  // Edit own ✓ / edit others' ✗
  for (const k of ['super', 'admin', 'dara', 'maya']) {
    const id = state.messageIds[k];
    await expectStatus(await api(`/api/messages/${id}`, { method: 'PATCH', token: token(k), body: { content: `${MARKER} edited by ${ACCOUNTS[k].role}` } }), 200, `${ACCOUNTS[k].role} edits their own message`);
  }
  await expectStatus(await api(`/api/messages/${state.messageIds.maya}`, { method: 'PATCH', token: token('dara'), body: { content: 'nope' } }), 400, 'Manager cannot edit someone else\u2019s message');

  // React ✓ (and remove own reaction)
  for (const k of ['super', 'admin', 'dara', 'maya']) {
    await expectStatus(await api(`/api/messages/${state.messageIds.admin}/reactions`, { method: 'POST', token: token(k), body: { reaction: '👍' } }), 201, `${ACCOUNTS[k].role} reacts to a message`);
  }
  for (const k of ['super', 'admin', 'dara', 'maya']) {
    await expectStatus(await api(`/api/messages/${state.messageIds.admin}/reactions/👍`, { method: 'DELETE', token: token(k) }), 200, `${ACCOUNTS[k].role} removes their reaction`);
  }

  // Delete own ✓ / delete others' ✗
  await expectStatus(await api(`/api/messages/${state.messageIds.maya}`, { method: 'DELETE', token: token('dara') }), 400, 'Manager cannot delete someone else\u2019s message');
  for (const k of ['super', 'admin', 'dara', 'maya']) {
    await expectStatus(await api(`/api/messages/${state.messageIds[k]}`, { method: 'DELETE', token: token(k) }), 200, `${ACCOUNTS[k].role} deletes their own message`);
  }

  // Search ✓
  for (const k of ['super', 'admin', 'dara', 'maya']) {
    await expectStatus(await api(`/api/search/messages?q=${encodeURIComponent(MARKER)}`, { token: token(k) }), 200, `${ACCOUNTS[k].role} searches messages`);
    await expectStatus(await api(`/api/search/users?q=${encodeURIComponent('Maya')}`, { token: token(k) }), 200, `${ACCOUNTS[k].role} searches users`);
  }

  // ---------------------------------------------------------------------
  section('Profile — every role can view + update their own');
  for (const k of ['super', 'admin', 'dara', 'maya']) {
    await expectStatus(await api(`/api/users/${ids[k]}`, { token: token(k) }), 200, `${ACCOUNTS[k].role} views their own profile`);
    await expectStatus(await api(`/api/users/${ids[k]}`, { method: 'PATCH', token: token(k), body: { job_title: null } }), 200, `${ACCOUNTS[k].role} updates their own profile`);
  }

  // ---------------------------------------------------------------------
  console.log(`\n${'═'.repeat(60)}`);
  if (failed === 0) {
    console.log(`🎉 ALL MATRIX CHECKS PASSED (${passed} checks)`);
  } else {
    console.log(`❌ ${failed} check(s) failed, ${passed} passed`);
  }
}

// ---------------------------------------------------------------------------
// Cleanup — API first, then marker-based SQL for the conversation + notifications
// ---------------------------------------------------------------------------
async function cleanup(sessions) {
  const token = (key) => sessions?.[key]?.token;

  // Remove members added to seeded teams (the same role that added them).
  for (const { teamId, memberId, deleter } of state.addedMembers) {
    if (sessions?.[deleter]?.token) {
      await api(`/api/teams/${teamId}/members/${memberId}`, { method: 'DELETE', token: sessions[deleter].token }).catch(() => {});
    }
  }

  // Delete created channels / teams / users (Company Admin may do all of these).
  for (const id of state.createdChannelIds) {
    if (id && token('admin')) await api(`/api/channels/${id}`, { method: 'DELETE', token: token('admin') }).catch(() => {});
  }
  for (const id of state.createdTeamIds) {
    if (id && token('admin')) await api(`/api/teams/${id}`, { method: 'DELETE', token: token('admin') }).catch(() => {});
  }
  for (const id of state.createdUserIds) {
    if (id && token('admin')) await api(`/api/users/${id}`, { method: 'DELETE', token: token('admin') }).catch(() => {});
  }

  // Marker-based SQL: the applied schema has NO cascading FKs (every FK is
  // NO ACTION), so API deletes of created teams/channels/users fail on child
  // rows. Delete by marker in dependency order instead:
  //   reactions → messages → conversation_members → conversations
  //   → channel_members → channels → team_members → teams
  //   → user_sessions/password_resets/notifications → users
  //   → notifications mentioning the marker.
  try {
    const connection = require('../dist/src/database/connection');
    const db = connection.default || connection;
    if (state.createdConversationId) {
      const convId = state.createdConversationId;
      const msgs = await db.query('SELECT id FROM messages WHERE conversation_id = ?', [convId]);
      const ids = msgs.map((m) => m.id);
      if (ids.length) {
        await db.query('DELETE FROM message_reactions WHERE message_id IN (?)', [ids]);
        await db.query('DELETE FROM messages WHERE id IN (?)', [ids]);
      }
      await db.query('DELETE FROM conversation_members WHERE conversation_id = ?', [convId]);
      await db.query('DELETE FROM conversations WHERE id = ?', [convId]);
    }

    // Channels created by the run (standalone + inside created teams).
    const chans = await db.query('SELECT id FROM channels WHERE name LIKE ?', [`${MARKER}-%`]);
    const chanIds = chans.map((c) => c.id);
    if (chanIds.length) {
      await db.query('DELETE FROM channel_members WHERE channel_id IN (?)', [chanIds]);
      await db.query('DELETE FROM channels WHERE id IN (?)', [chanIds]);
    }

    // Teams created by the run (creators are auto-added as team members).
    const teams = await db.query('SELECT id FROM teams WHERE name LIKE ?', [`%${MARKER}%`]);
    const teamIds = teams.map((t) => t.id);
    if (teamIds.length) {
      await db.query('DELETE FROM team_members WHERE team_id IN (?)', [teamIds]);
      await db.query('DELETE FROM teams WHERE id IN (?)', [teamIds]);
    }

    // Users created by the run (created via the employees API).
    const users = await db.query('SELECT id FROM users WHERE email LIKE ?', [`%${MARKER}%`]);
    const userIds = users.map((u) => u.id);
    if (userIds.length) {
      await db.query('DELETE FROM user_sessions WHERE user_id IN (?)', [userIds]);
      await db.query('DELETE FROM password_resets WHERE user_id IN (?)', [userIds]);
      await db.query('DELETE FROM notifications WHERE user_id IN (?) OR actor_id IN (?)', [userIds, userIds]);
      await db.query('DELETE FROM users WHERE id IN (?)', [userIds]);
    }

    // Notifications mentioning the marker.
    await db.query('DELETE FROM notifications WHERE message LIKE ? OR title LIKE ?', [`%${MARKER}%`, `%${MARKER}%`]);
    await db.pool.end().catch(() => {});
    console.log(`  🧹 Cleaned up all test rows (${MARKER})`);
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
    // Re-login admin for cleanup if the flow died mid-way.
    let sessions = null;
    try {
      // sessions are captured inside main; for failure cleanup just login admin.
      const { status, json } = await api('/api/auth/login', {
        method: 'POST',
        body: { email: ACCOUNTS.admin.email, password: PASSWORD },
      });
      if (status === 200 && json?.data?.token) {
        sessions = { admin: json.data };
        // Also need dara to remove her added member.
        const d = await api('/api/auth/login', {
          method: 'POST',
          body: { email: ACCOUNTS.dara.email, password: PASSWORD },
        });
        if (d.status === 200) sessions.dara = d.json.data;
      }
    } catch {
      /* login for cleanup failed — best effort */
    }
    await cleanup(sessions);
    process.exit(process.exitCode || (passed > 0 && failed === 0 ? 0 : 1));
  });
