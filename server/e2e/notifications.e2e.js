#!/usr/bin/env node
/**
 * KneaChat — End-to-end test: live toast + unread badge pipeline (no browser).
 *
 * Simulates the two-window scenario entirely over HTTP + WebSocket:
 *   • Window A (sender): admin self-joins the "#general" channel conversation
 *     (the same REST call the UI makes) and sends messages over WebSocket —
 *     one that @mentions Maya Chen, one plain message.
 *   • Window B (recipient): a WebSocket session for Maya Chen asserts that the
 *     exact events which drive the UI arrive:
 *         - `receive_message`  → the message renders without a refresh
 *         - `notification`     → Dashboard shows a toast and refreshes the bell
 *           (type `mention` when she is @mentioned, `new_message` otherwise,
 *           both carrying `conversationId` so the sidebar badge can appear)
 *   • Badge state: verifies Maya's unread count increases and that marking a
 *     notification read (what clicking the channel does) clears it.
 *   • Ground truth + cleanup: confirms the rows persisted in MySQL and then
 *     deletes the messages/notifications this run created (marker-based), so
 *     the test is repeatable and leaves the demo data untouched.
 *
 * Requirements: a running KneaChat backend (REST on :8080, WS on :8080 by
 * default) with the seeded demo users. Node 18+ (uses global fetch).
 *
 * Usage:
 *   npm run test:e2e                     # run against localhost
 *   API_BASE=http://host:8080 npm run test:e2e
 *   npm run test:e2e -- --keep           # leave created rows in the DB
 *
 * Exit code 0 = all checks passed.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const WebSocket = require('ws');

const API_BASE = process.env.API_BASE || 'http://localhost:8080';
const WS_URL = process.env.WS_URL || 'ws://localhost:8080';
const KEEP = process.argv.includes('--keep');

// Unique per run so cleanup only ever touches this run's artifacts.
const MARKER = `e2e-${process.pid}-${Date.now()}`;

const CONV_NAME = process.env.E2E_CHANNEL || 'general';
const SENDER_EMAIL = process.env.E2E_SENDER_EMAIL || 'admin@kneachat.com';
const RECIPIENT_EMAIL = process.env.E2E_RECIPIENT_EMAIL || 'maya@kneachat.com';
const PASSWORD = process.env.E2E_PASSWORD || 'kneachat168';

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
  return ok;
}

function section(title) {
  console.log(`\n── ${title} ─${'─'.repeat(Math.max(0, 56 - title.length))}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
// WebSocket helpers
// ---------------------------------------------------------------------------
function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
    const events = [];
    ws.on('message', (data) => {
      try {
        events.push(JSON.parse(data.toString()));
      } catch {
        /* ignore malformed frames */
      }
    });
    ws.on('open', () => resolve({ ws, events }));
    ws.on('error', reject);
  });
}

/** Resolve as soon as `predicate` matches an event, or null after the timeout. */
function waitFor(events, predicate, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const hit = events.find(predicate);
    if (hit) return resolve(hit);
    const started = Date.now();
    const timer = setInterval(() => {
      const found = events.find(predicate);
      if (found) {
        clearInterval(timer);
        resolve(found);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve(null);
      }
    }, 100);
  });
}

/** Notification `data` is a JSON column — accept both object and string forms. */
function conversationIdOf(notification) {
  try {
    const data = typeof notification.data === 'string' ? JSON.parse(notification.data) : notification.data;
    return Number(data?.conversationId) || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------
async function main() {
  console.log(`KneaChat E2E — live toast + unread badge pipeline (no browser)`);
  console.log(`  API : ${API_BASE}`);
  console.log(`  WS  : ${WS_URL}`);
  console.log(`  mark: ${MARKER}${KEEP ? '  (--keep: leaving artifacts)' : ''}`);

  // 0. Preflight — the server must be reachable.
  section('Preflight');
  let health;
  try {
    health = await api('/api/health');
  } catch {
    health = { status: 0 };
  }
  if (health.status !== 200) {
    console.log(`  ❌ Cannot reach KneaChat API at ${API_BASE}/api/health`);
    console.log(`     Start the backend first: cd server && npm run dev`);
    console.log(`     (or point API_BASE / WS_URL at a running instance)`);
    process.exit(1);
  }
  console.log('  ✅ Server is up');

  // 1. Authenticate both actors (the two "windows").
  section('Authentication');
  const admin = await login(SENDER_EMAIL);
  const maya = await login(RECIPIENT_EMAIL);
  console.log(`  ✅ ${SENDER_EMAIL} (admin window) — id ${admin.user?.id}`);
  console.log(`  ✅ ${RECIPIENT_EMAIL} (recipient window) — id ${maya.user?.id}`);
  const senderId = admin.user?.id;
  const recipientId = maya.user?.id;
  if (!senderId || !recipientId) throw new Error('Login payload missing user id');

  // 2. Resolve the channel conversation (self-join replicates the UI).
  section('Channel conversation');
  const { json: convList } = await api('/api/conversations', { token: admin.token });
  let conv =
    (convList?.data?.conversations || []).find(
      (c) => c.type === 'channel' && c.name === CONV_NAME,
    ) || null;
  if (!conv) {
    const created = await api('/api/conversations', {
      method: 'POST',
      token: admin.token,
      body: { type: 'channel', name: CONV_NAME },
    });
    conv = created.json?.data?.conversation || null;
    if (!conv) throw new Error(`Could not find or create a channel conversation named "${CONV_NAME}"`);
    console.log(`  ℹ️  Created missing channel conversation for #${CONV_NAME}`);
  }
  const convId = Number(conv.id);
  check(`#${CONV_NAME} conversation resolved (id ${convId})`, Number.isFinite(convId) && convId > 0);

  const isSenderMember = (conv.members || []).some((m) => Number(m.id) === Number(senderId));
  if (!isSenderMember) {
    const join = await api(`/api/conversations/${convId}/members`, {
      method: 'POST',
      token: admin.token,
      body: { user_id: senderId },
    });
    check(`sender self-joins #${CONV_NAME} (HTTP ${join.status})`, join.status < 400, JSON.stringify(join.json));
  } else {
    check(`sender is already a member of #${CONV_NAME}`, true);
  }

  const { json: userList } = await api('/api/users', { token: admin.token });
  const recipient = (userList?.data?.users || []).find((u) => u.email === RECIPIENT_EMAIL);
  check(`recipient ${RECIPIENT_EMAIL} found (id ${recipient?.id})`, !!recipient);

  // 3. Open the two WebSocket sessions + capture the recipient's unread
  // baseline BEFORE any message is sent (badge/bell start state).
  section('WebSocket sessions');
  const mayaWs = await connectSocket(maya.token);
  const adminWs = await connectSocket(admin.token);
  await sleep(600); // let acks + presence settle
  check('recipient socket connected', !!mayaWs);
  check('sender socket connected', !!adminWs);

  const baseline = await api('/api/notifications', { token: maya.token });
  const baselineUnread = Number(baseline.json?.data?.unreadCount || 0);
  console.log(`  ℹ️  Recipient unread baseline: ${baselineUnread}`);

  const sendMessage = (content) =>
    adminWs.ws.send(JSON.stringify({ type: 'send_message', conversationId: convId, content }));

  // 4. Scenario A — @mention → the toast/badge path (US-16 / FR-15).
  section('Scenario A: @mention (toast + badge path)');
  const mentionContent = `@Maya Chen e2e mention ${MARKER}`;
  sendMessage(mentionContent);

  const ack = await waitFor(adminWs.events, (e) => e.type === 'message_sent_ack');
  check('sender receives message_sent_ack', !!ack);

  const recvMsg = await waitFor(
    mayaWs.events,
    (e) => e.type === 'receive_message' && Number(e.message?.conversationId) === convId,
  );
  check('recipient receives receive_message (real-time render)', !!recvMsg);
  check('delivered content matches', recvMsg?.message?.content === mentionContent, recvMsg?.message?.content);

  const mentionEvt = await waitFor(
    mayaWs.events,
    (e) => e.type === 'notification' && e.data?.type === 'mention',
  );
  check('recipient receives notification event (drives toast + badge)', !!mentionEvt);
  const mentionData = mentionEvt?.data || {};
  check('mention event carries conversationId', Number(mentionData.conversationId) === convId);
  check(
    'mention event title says "mentioned you"',
    typeof mentionData.title === 'string' && /mentioned you/i.test(mentionData.title),
    mentionData.title,
  );
  // The server must not notify the sender about their own message — the
  // sender socket should never see a `notification` event for this send.
  check('sender receives no notification event for their own message',
    !adminWs.events.some((e) => e.type === 'notification'),
    adminWs.events.map((e) => e.type).join(', '),
  );

  // 5. Scenario B — plain message → the `new_message` notification path.
  section('Scenario B: plain message (new_message path)');
  const plainContent = `e2e plain message ${MARKER}`;
  sendMessage(plainContent);

  const newMsgEvt = await waitFor(
    mayaWs.events,
    (e) => e.type === 'notification' && e.data?.type === 'new_message',
  );
  check('recipient receives new_message notification event', !!newMsgEvt);
  check(
    'new_message event carries conversationId',
    Number(newMsgEvt?.data?.conversationId) === convId,
  );

  // 6. Scenario C — badge/bell state (unread count) + mark-read clears it.
  section('Scenario C: unread state + mark-read (badge lifecycle)');
  const after = await api('/api/notifications', { token: maya.token });
  const afterUnread = Number(after.json?.data?.unreadCount || 0);
  check('unread count increased by 2 (badge/bell would show it)', afterUnread - baselineUnread >= 2, `before=${baselineUnread} after=${afterUnread}`);

  const notifs = after.json?.data?.notifications || [];
  const mentionNotif = notifs.find(
    (n) => n.type === 'mention' && String(n.message || '').includes(MARKER),
  );
  check('mention notification persisted (unread, with conversationId)', !!mentionNotif);
  check(
    'mention notification is unread (is_read = 0)',
    !!mentionNotif && Number(mentionNotif.is_read) === 0,
  );
  check(
    'mention notification links to the right conversation',
    !!mentionNotif && conversationIdOf(mentionNotif) === convId,
  );

  const markRes = mentionNotif
    ? await api(`/api/notifications/${mentionNotif.id}/read`, {
        method: 'PATCH',
        token: maya.token,
      })
    : null;
  if (!markRes) {
    // Never reached when the persistence checks above pass; guards against a
    // confusing TypeError (and keeps cleanup running) on server regressions.
    check('mark-read flow available', false, 'mention notification missing');
  } else {
    check('mark-read endpoint accepts the notification (HTTP ' + markRes.status + ')', markRes.status < 400);

    const afterMark = await api('/api/notifications', { token: maya.token });
    const markNotif = (afterMark.json?.data?.notifications || []).find((n) => n.id === mentionNotif.id);
    check('mark-read persisted (is_read = 1, badge clears)', !!markNotif && Number(markNotif.is_read) === 1);
  }

  mayaWs.ws.close();
  adminWs.ws.close();

  // 7. Cleanup — remove only this run's artifacts (marker-based).
  section('Cleanup');
  await cleanup();

  console.log(`\n${'═'.repeat(60)}`);
  if (failed === 0) {
    console.log(`🎉 ALL CHECKS PASSED (${passed} passed)`);
  } else {
    console.log(`❌ ${failed} check(s) failed, ${passed} passed`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

async function cleanup() {
  if (KEEP) {
    console.log('  (--keep: artifacts left in the DB for inspection)');
    return;
  }
  let db;
  try {
    db = require('../dist/src/database/connection');
    db = db.default || db;
  } catch {
    db = null;
  }
  if (!db) {
    console.warn('  ⚠  DB cleanup skipped — database module unavailable (MySQL not local?)');
    return;
  }
  try {
    const like = `%${MARKER}%`;
    const rows = await db.query('SELECT id, content FROM messages WHERE content LIKE ?', [like]);
    await db.query('DELETE FROM notifications WHERE message LIKE ?', [like]);
    await db.query('DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE content LIKE ?)', [like]);
    await db.query('DELETE FROM messages WHERE content LIKE ?', [like]);
    await db.pool.end().catch(() => {});
    console.log(`  🧹 Removed ${rows.length} test message(s) + their notifications (marker ${MARKER})`);
  } catch (error) {
    console.warn(`  ⚠  DB cleanup failed: ${error.message} (rows can be removed manually by searching "${MARKER}")`);
  }
}

main().catch((error) => {
  console.error('\n❌ E2E script error:', error.message);
  process.exit(1);
});
