#!/usr/bin/env node
/**
 * KneaChat — End-to-end test: Email omni-channel inbox (no browser, no manual
 * email interaction required for the default run).
 *
 * What it exercises, in order:
 *   1. Channel health   — GET /api/email/health (SMTP configured flag).
 *   2. Inbound pipeline — a synthetic Mailgun-style "inbound email" webhook is
 *                         POSTed to /api/email/webhook with a valid generic
 *                         HMAC signature (same controller a provider hits).
 *                         Asserts the contact/conversation is found or
 *                         created, the message is persisted, the agent sees
 *                         `receive_message` + `notification` over WebSocket,
 *                         and the external ledger row is written.
 *   3. Duplicate guard  — replaying the same Message-ID must not double-persist
 *                         (unique (channel, external_message_id) key).
 *   4. Webhook security — an invalid signature must be rejected with 401.
 *   5. Inbox actions    — assign / unclaim / close / reopen smoke tests on
 *                         the omni conversation (no SMTP calls).
 *   6. Real delivery    — OPT-IN (E2E_REAL_DELIVERY=1): an agent reply is sent
 *                         through real SMTP to the fixture address, verifying
 *                         the deliver-then-persist outbound leg.
 *
 * Artifacts: everything carries a unique MARKER. Cleanup deletes this run's
 * messages / notifications / ledger rows and (by default) the synthetic
 * customer fixture, FK-safe. Keep it with E2E_KEEP_FIXTURE=1 to reuse the
 * contact across runs.
 *
 * Requirements:
 *   - a running backend (REST + WS on :8080 by default) with seeded demo users
 *   - EMAIL_WEBHOOK_SECRET configured in server/.env
 *   - server/dist built (DB ground-truth checks import the connection module)
 *
 * Usage:
 *   npm run test:e2e:email
 *   API_BASE=http://host:8080 node e2e/email-omni.e2e.js
 *   node e2e/email-omni.e2e.js --keep              # leave artifacts
 *   E2E_REAL_DELIVERY=1 node e2e/email-omni.e2e.js # + real SMTP reply leg
 *
 * Exit code 0 = all checks passed.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const crypto = require('crypto');
const WebSocket = require('ws');

const API_BASE = process.env.API_BASE || 'http://localhost:8080';
const WS_URL = process.env.WS_URL || 'ws://localhost:8080';
const KEEP = process.argv.includes('--keep');
const REAL_DELIVERY = process.env.E2E_REAL_DELIVERY === '1';

const AGENT_EMAIL = process.env.E2E_AGENT_EMAIL || 'admin@kneachat.com';
const PASSWORD = process.env.E2E_PASSWORD || 'kneachat168';
const WEBHOOK_SECRET = process.env.EMAIL_WEBHOOK_SECRET || '';

// The synthetic customer the webhook posts as. A FIXED address so the first
// run creates the contact/conversation and later runs reuse it.
// For REAL SMTP delivery tests (E2E_REAL_DELIVERY=1), replace with a real
// inbox you control so the agent reply actually lands somewhere.
const CUSTOMER_EMAIL = process.env.E2E_EMAIL_CUSTOMER || 'e2e-mail-customer@external.test';
const CUSTOMER_NAME_PREFIX = 'E2E MailCustomer';
const INBOX_ADDRESS = process.env.E2E_INBOX_ADDRESS || 'support@kneachat.local';

// Unique per run so cleanup only ever touches this run's artifacts.
const MARKER = `e2e-${process.pid}-${Date.now()}`;
const INBOUND_CONTENT = `e2e inbound ${MARKER} hello from email`;
const MESSAGE_ID = `e2e-${process.pid}-${Date.now()}@external.test`;

// The fixture cannot receive mail, so a leftover conversation only clutters
// the inbox; teardown removes it by default. Opt out for repeat runs.
const KEEP_FIXTURE = process.env.E2E_KEEP_FIXTURE === '1';

// ---------------------------------------------------------------------------
// Tiny test harness (same shape as telegram-omni.e2e.js)
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

async function login(email) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const json = await res.json().catch(() => null);
  if (res.status !== 200 || !json?.data?.token) {
    throw new Error(`Login failed for ${email} (HTTP ${res.status}): ${JSON.stringify(json)}`);
  }
  return json.data;
}

/** The generic webhook signature: HMAC-SHA256 over the exact JSON body. */
function signPayload(payloadString) {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(payloadString).digest('base64');
}

/**
 * Mailgun-style stored-message body (what Mailgun's store-and-notify route
 * forwards). The engine detects it by recipient+subject and reads body-plain /
 * message-headers — exercising that provider branch for real.
 *
 * Overridable so the threading scenario can post a reply (In-Reply-To /
 * References) and a fresh subject without duplicating the builder.
 */
function buildInboundPayload(overrides = {}) {
  const messageId = overrides.messageId || MESSAGE_ID;
  const subject = overrides.subject || `e2e email omni ${MARKER}`;
  const content = overrides.content || INBOUND_CONTENT;
  const headers = JSON.stringify([
    ['Message-Id', `<${messageId}>`],
    ['From', `${CUSTOMER_NAME_PREFIX} <${CUSTOMER_EMAIL}>`],
    ['To', INBOX_ADDRESS],
    ['Subject', subject],
    ...(overrides.inReplyTo ? [['In-Reply-To', `<${overrides.inReplyTo}>`]] : []),
    ...(overrides.references ? [['References', `<${overrides.references}>`]] : []),
  ]);
  return {
    recipient: INBOX_ADDRESS,
    sender: CUSTOMER_EMAIL,
    from: `${CUSTOMER_NAME_PREFIX} <${CUSTOMER_EMAIL}>`,
    subject,
    'body-plain': content,
    'body-html': `<p>${content}</p>`,
    'stripped-text': content,
    'stripped-html': `<p>${content}</p>`,
    'message-headers': headers,
    timestamp: Math.floor(Date.now() / 1000),
  };
}

async function postWebhook(payloadString, signature) {
  return fetch(`${API_BASE}/api/email/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Email-Webhook-Secret': WEBHOOK_SECRET,
      'X-Email-Signature': signature,
    },
    body: payloadString,
  });
}

// ---------------------------------------------------------------------------
// WebSocket helpers (same shape as telegram-omni.e2e.js)
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

// ---------------------------------------------------------------------------
// DB ground-truth helpers (dist module, same as telegram-omni.e2e.js)
// ---------------------------------------------------------------------------
function openDb() {
  return require('../dist/src/database/connection').default;
}

async function safeQuery(db, sql, params) {
  try {
    const rows = await db.query(sql, params);
    return Array.isArray(rows) ? rows : rows?.[0] || [];
  } catch (error) {
    console.warn(`    (query failed: ${error.message})`);
    return [];
  }
}

async function resolveFixtureConversation(db) {
  const contacts = await safeQuery(
    db,
    "SELECT id, user_id FROM external_contacts WHERE channel = 'email' AND email_address = ? LIMIT 1",
    [CUSTOMER_EMAIL],
  );
  const contact = contacts[0];
  if (!contact) return { contactId: null, shadowUserId: null, conversationId: null };
  const convs = await safeQuery(
    db,
    'SELECT conversation_id FROM external_conversations WHERE contact_id = ? LIMIT 1',
    [contact.id],
  );
  return {
    contactId: contact.id,
    shadowUserId: contact.user_id,
    conversationId: convs[0]?.conversation_id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------
let exitCode = 0;

async function main() {
  console.log('KneaChat E2E — Email omni-channel inbox');
  console.log(`  API : ${API_BASE}`);
  console.log(`  WS  : ${WS_URL}`);
  console.log(`  mark: ${MARKER}${KEEP ? '  (--keep: leaving artifacts)' : ''}`);
  if (REAL_DELIVERY) console.log('  real delivery: ENABLED (agent reply goes through real SMTP)');

  // 0. Preflight — the server must be reachable.
  section('Preflight');
  let health;
  try {
    health = await fetch(`${API_BASE}/api/health`);
  } catch {
    health = { status: 0 };
  }
  if (health.status !== 200) {
    console.log(`  ❌ Cannot reach KneaChat API at ${API_BASE}/api/health`);
    console.log('     Start the backend first: cd server && npm run dev');
    exitCode = 1;
    return;
  }
  console.log('  ✅ Server is up');
  if (!WEBHOOK_SECRET) {
    console.log('  ⚠  EMAIL_WEBHOOK_SECRET is not set — the webhook runs unprotected.');
    console.log('     Set it in server/.env and restart the backend, then re-run.');
    exitCode = 1;
    return;
  }

  // 1. Authenticate the agent.
  section('Authentication');
  const agent = await login(AGENT_EMAIL);
  console.log(`  ✅ ${AGENT_EMAIL} (agent) — id ${agent.user?.id}`);
  if (!agent.user?.id) throw new Error('Login payload missing user id');

  // 2. Channel health — SMTP config must be present (connectivity is env).
  section('Email channel health');
  const emailHealthRes = await fetch(`${API_BASE}/api/email/health`);
  const emailHealth = await emailHealthRes.json().catch(() => null);
  check(
    `email channel reports configured (HTTP ${emailHealthRes.status})`,
    emailHealth?.info?.configured === true,
    JSON.stringify(emailHealth),
  );
  if (emailHealth?.info?.smtpConnected === false) {
    console.log('  ⚠  SMTP is configured but not reachable — check EMAIL_SMTP_* credentials.');
    console.log('     Inbound email still works; agent replies will fail until SMTP connects.');
  }

  // 3. Connect the agent socket BEFORE the inbound POST so the realtime
  //    fan-out can be observed.
  section('WebSocket session');
  const agentWs = await connectSocket(agent.token);
  await sleep(600);
  check('agent socket connected', !!agentWs);

  // 4. Inbound pipeline — POST a synthetic inbound email to the webhook.
  section('Inbound: synthetic email webhook');
  const payload = buildInboundPayload();
  const payloadString = JSON.stringify(payload);
  const hookPost = await postWebhook(payloadString, signPayload(payloadString));
  check('webhook POST acknowledged', hookPost.status === 200, `HTTP ${hookPost.status}`);

  const [msgEvent, notifEvent] = await Promise.all([
    waitFor(agentWs.events, (e) => e?.type === 'receive_message' && JSON.stringify(e).includes(MARKER)),
    waitFor(agentWs.events, (e) => e?.type === 'notification' && JSON.stringify(e).includes(MARKER)),
  ]);
  check("agent received 'receive_message' in realtime", !!msgEvent);
  check("agent received 'notification' in realtime", !!notifEvent);

  // 5. Ground truth — ledger row + persisted message + agent-visible message.
  section('Persistence (DB ground truth)');
  const db = openDb();
  const fixture = await resolveFixtureConversation(db);
  if (!check('external contact exists for the sender', !!fixture.contactId, CUSTOMER_EMAIL)) {
    throw new Error('Inbound pipeline did not persist the contact — nothing else to verify');
  }
  check('external conversation exists for the contact', !!fixture.conversationId);
  const ledger = await safeQuery(
    db,
    'SELECT id FROM external_messages WHERE conversation_id = ? AND external_message_id = ?',
    [fixture.conversationId, MESSAGE_ID],
  );
  check('external_messages ledger row written', ledger.length === 1, `found ${ledger.length}`);
  const persisted = await safeQuery(
    db,
    'SELECT id FROM messages WHERE conversation_id = ? AND content LIKE ?',
    [fixture.conversationId, `%${MARKER}%`],
  );
  check('message persisted to the conversation', persisted.length === 1, `found ${persisted.length}`);

  const agentViewRes = await fetch(`${API_BASE}/api/conversations/${fixture.conversationId}/messages`, {
    headers: { Authorization: `Bearer ${agent.token}` },
  });
  const agentView = await agentViewRes.json().catch(() => null);
  check(
    'agent can read the message via REST',
    agentViewRes.status === 200 && JSON.stringify(agentView).includes(MARKER),
    `HTTP ${agentViewRes.status}`,
  );

  // 6. Duplicate guard — replay the same Message-ID: no double-persist.
  section('Duplicate protection');
  await postWebhook(payloadString, signPayload(payloadString));
  await sleep(500);
  const afterReplay = await safeQuery(
    db,
    'SELECT id FROM messages WHERE conversation_id = ? AND content LIKE ?',
    [fixture.conversationId, `%${MARKER}%`],
  );
  check('replayed Message-ID did not double-persist', afterReplay.length === 1, `found ${afterReplay.length}`);

  // 6b. Email threading — a reply (In-Reply-To = the first Message-ID) must
  //     join the SAME conversation, while an unrelated subject starts a NEW
  //     one for the same contact (migration 030: conversations per thread).
  section('Email thread resolution');
  const REPLY_MESSAGE_ID = `e2e-reply-${process.pid}-${Date.now()}@external.test`;
  const REPLY_MARKER = `e2e-threaded-reply-${process.pid}-${Date.now()}`;
  const replyPayload = buildInboundPayload({
    messageId: REPLY_MESSAGE_ID,
    subject: `Re: e2e email omni ${MARKER}`,
    content: `${REPLY_MARKER} replying to the first email`,
    inReplyTo: MESSAGE_ID,
    references: MESSAGE_ID,
  });
  const replyString = JSON.stringify(replyPayload);
  const replyPost = await postWebhook(replyString, signPayload(replyString));
  check('threaded reply webhook acknowledged', replyPost.status === 200, `HTTP ${replyPost.status}`);
  await sleep(500);
  const replyRows = await safeQuery(
    db,
    'SELECT conversation_id FROM external_messages WHERE external_message_id = ?',
    [REPLY_MESSAGE_ID],
  );
  check(
    'threaded reply joined the original conversation',
    replyRows.length === 1 && replyRows[0].conversation_id === fixture.conversationId,
    `got ${JSON.stringify(replyRows)}`,
  );

  const NEW_MESSAGE_ID = `e2e-new-${process.pid}-${Date.now()}@external.test`;
  const NEW_MARKER = `e2e-new-thread-${process.pid}-${Date.now()}`;
  const newPayload = buildInboundPayload({
    messageId: NEW_MESSAGE_ID,
    subject: `Fresh topic ${MARKER}`,
    content: `${NEW_MARKER} starting a new thread`,
  });
  const newString = JSON.stringify(newPayload);
  const newPost = await postWebhook(newString, signPayload(newString));
  check('new-thread webhook acknowledged', newPost.status === 200, `HTTP ${newPost.status}`);
  await sleep(500);
  const newRow = await safeQuery(
    db,
    'SELECT conversation_id FROM external_messages WHERE external_message_id = ?',
    [NEW_MESSAGE_ID],
  );
  const newConvId = newRow[0]?.conversation_id ?? null;
  check(
    'unrelated subject started a second conversation for the same contact',
    newRow.length === 1 && newConvId !== fixture.conversationId,
    `got ${JSON.stringify(newRow)}`,
  );
  if (newConvId) {
    const newConvName = await safeQuery(
      db,
      'SELECT name FROM conversations WHERE id = ?',
      [newConvId],
    );
    check(
      'new thread conversation is named after the email subject',
      (newConvName[0]?.name || '').includes(`Fresh topic ${MARKER}`),
      String(newConvName[0]?.name),
    );
  }

  // The outbound-reply leg below (opt-in) targets the ORIGINAL conversation —
  // thread 1 — not the newly created second thread.

  // 7. Webhook security — an invalid signature must be rejected.
  section('Webhook security');
  const badPost = await postWebhook(payloadString, 'bm90LWEtcmVhbC1zaWduYXR1cmU=');
  check('invalid signature rejected with 401', badPost.status === 401, `HTTP ${badPost.status}`);

  // 8. Inbox actions — assign / unclaim / close / reopen (no SMTP calls) —
  // exercised on the ORIGINAL thread conversation.
  section('Inbox actions');
  const convId = fixture.conversationId;
  const assign = await fetch(`${API_BASE}/api/omni/conversations/${convId}/assign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agent.token}` },
  });
  check('agent can claim the conversation', assign.status === 200 || assign.status === 201, `HTTP ${assign.status}`);
  const unassign = await fetch(`${API_BASE}/api/omni/conversations/${convId}/assign`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${agent.token}` },
  });
  check('agent can unclaim the conversation', unassign.status === 200 || unassign.status === 204, `HTTP ${unassign.status}`);
  const close = await fetch(`${API_BASE}/api/omni/conversations/${convId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agent.token}` },
    body: JSON.stringify({ status: 'closed' }),
  });
  check('conversation can be closed', close.status === 200, `HTTP ${close.status}`);
  const reopen = await fetch(`${API_BASE}/api/omni/conversations/${convId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agent.token}` },
    body: JSON.stringify({ status: 'open' }),
  });
  check('conversation can be reopened', reopen.status === 200, `HTTP ${reopen.status}`);

  // 9. Real delivery — OPT-IN: the reply goes through real SMTP.
  section('Outbound reply (opt-in)');
  if (!REAL_DELIVERY) {
    console.log('  ℹ️  skipped (set E2E_REAL_DELIVERY=1 to exercise SMTP delivery)');
  } else {
    const replyRes = await fetch(`${API_BASE}/api/omni/conversations/${convId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agent.token}` },
      body: JSON.stringify({ text: `e2e reply ${MARKER}` }),
    });
    const replyJson = await replyRes.json().catch(() => null);
    if (replyRes.status === 200 || replyRes.status === 201) {
      check('agent reply accepted for delivery', true);
      const replyPersisted = await safeQuery(
        db,
        'SELECT id FROM messages WHERE conversation_id = ? AND content LIKE ?',
        [convId, `%e2e reply ${MARKER}%`],
      );
      check('outbound reply persisted after successful delivery', replyPersisted.length === 1);
    } else {
      const persistedOnFail = await safeQuery(
        db,
        'SELECT id FROM messages WHERE conversation_id = ? AND content LIKE ?',
        [convId, `%e2e reply ${MARKER}%`],
      );
      check(
        `failed delivery (HTTP ${replyRes.status}) persisted nothing — deliver-then-persist holds`,
        persistedOnFail.length === 0,
        JSON.stringify(replyJson).slice(0, 200),
      );
    }
  }

  agentWs.ws.close();

  console.log(`\n════════════════════════════════════════════`);
  console.log(`  ${passed}/${passed + failed} checks passed${failed > 0 ? `, ${failed} FAILED` : ' — all good'}`);
  console.log(`════════════════════════════════════════════`);
  if (failed > 0) exitCode = 1;
}

// ---------------------------------------------------------------------------
// Cleanup — FK-safe, marker-scoped (same shape as telegram-omni.e2e.js)
// ---------------------------------------------------------------------------
async function cleanup() {
  let db;
  try {
    db = openDb();
  } catch {
    console.warn('  ⚠  DB cleanup skipped — database module unavailable');
    console.warn(`     Remove rows manually by searching for "${MARKER}"`);
    return;
  }
  try {
    const like = `%${MARKER}%`;

    // Notifications carry a content snippet → marker match.
    await safeQuery(db, 'DELETE FROM notifications WHERE message LIKE ?', [like]);

    // This run's messages (inbound + any real-delivery reply). The external
    // ledger cascades on message delete; deleted explicitly anyway.
    const msgs = await safeQuery(db, 'SELECT id, conversation_id FROM messages WHERE content LIKE ?', [like]);
    const convIds = [...new Set(msgs.map((m) => m.conversation_id).filter(Boolean))];

    // Fixture teardown — the synthetic customer cannot receive mail, so a
    // leftover conversation only clutters the inbox. With per-thread
    // conversations (migration 030) the contact may hold several; delete them
    // all, and the shadow user only after every conversation is gone.
    let fixtureShadowUser = null;
    if (!KEEP_FIXTURE) {
      const fixtureContacts = await safeQuery(
        db,
        "SELECT id, user_id FROM external_contacts WHERE channel = 'email' AND email_address = ?",
        [CUSTOMER_EMAIL],
      );
      for (const contact of fixtureContacts) {
        fixtureShadowUser = contact.user_id;
        const convRows = await safeQuery(
          db,
          'SELECT conversation_id FROM external_conversations WHERE contact_id = ?',
          [contact.id],
        );
        for (const row of convRows) {
          if (!convIds.includes(row.conversation_id)) convIds.push(row.conversation_id);
        }
      }
    }

    for (const convId of convIds) {
      // FK-safe order, mirroring telegram-omni.e2e.js teardown.
      const ecRows = await safeQuery(db, 'SELECT contact_id FROM external_conversations WHERE conversation_id = ?', [convId]);
      const contactId = ecRows[0]?.contact_id ?? null;
      let shadowUser = null;
      if (contactId) {
        const cRows = await safeQuery(db, 'SELECT user_id FROM external_contacts WHERE id = ?', [contactId]);
        shadowUser = cRows[0]?.user_id ?? null;
      }
      await safeQuery(db, 'DELETE FROM notifications WHERE user_id = ? OR actor_id = ?', [shadowUser, shadowUser]);
      await safeQuery(db, 'DELETE mb FROM message_bookmarks mb JOIN messages m ON m.id = mb.message_id WHERE m.conversation_id = ?', [convId]);
      await safeQuery(db, 'DELETE mr FROM message_reminders mr JOIN messages m ON m.id = mr.message_id WHERE m.conversation_id = ?', [convId]);
      await safeQuery(db, 'DELETE a FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.conversation_id = ?', [convId]);
      await safeQuery(db, 'DELETE r FROM message_reactions r JOIN messages m ON m.id = r.message_id WHERE m.conversation_id = ?', [convId]);
      await safeQuery(db, 'DELETE FROM external_messages WHERE conversation_id = ?', [convId]);
      await safeQuery(db, 'DELETE FROM messages WHERE conversation_id = ?', [convId]);
      await safeQuery(db, 'DELETE FROM conversation_members WHERE conversation_id = ?', [convId]);
      await safeQuery(db, 'DELETE FROM external_conversations WHERE conversation_id = ?', [convId]);
      await safeQuery(db, 'DELETE FROM external_contacts WHERE id = ?', [contactId]);
      await safeQuery(db, 'DELETE FROM conversations WHERE id = ?', [convId]);
    }

    // The shadow user backs every conversation of the fixture contact — only
    // removable after all of them are gone (FK from external_contacts.user_id).
    if (fixtureShadowUser) {
      await safeQuery(db, 'DELETE FROM users WHERE id = ? AND role = ?', [fixtureShadowUser, 'external']);
    }

    console.log(`  🧹 Removed ${msgs.length} test message(s) + artifacts (marker ${MARKER})`);
    if (KEEP_FIXTURE) {
      console.log(`  ℹ️  Kept fixture: ${CUSTOMER_EMAIL} for reuse by future runs`);
    } else {
      console.log(`  🧹 Removed synthetic fixture (${CUSTOMER_NAME_PREFIX} (Email))`);
    }

    await db.pool.end().catch(() => {});
  } catch (error) {
    console.warn(`  ⚠  DB cleanup failed: ${error.message} (rows can be removed manually by searching "${MARKER}")`);
  }
}

main()
  .catch((error) => {
    console.error('\n❌ E2E script error:', error.message);
    exitCode = 1;
  })
  .finally(async () => {
    if (!KEEP) await cleanup();
    process.exit(exitCode);
  });
