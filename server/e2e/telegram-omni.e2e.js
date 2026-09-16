#!/usr/bin/env node
/**
 * KneaChat — End-to-end test: Telegram omni-channel inbox (no browser,
 * no manual Telegram interaction required for the default run).
 *
 * What it exercises, in order:
 *   1. Channel health   — GET /api/omni/health/telegram (bot token configured
 *                         and authenticates with the Telegram API).
 *   2. Webhook config   — read-only getWebhookInfo: a public webhook URL must
 *                         be registered (the tunnel itself is environment).
 *   3. Inbound pipeline — a synthetic Telegram "message" webhook is POSTed to
 *                         the local webhook endpoint (same controller Telegram
 *                         hits through the tunnel). Asserts the customer is
 *                         found/created, the message is persisted, the agent
 *                         sees `receive_message` + `notification` over
 *                         WebSocket, and the external ledger row is written.
 *   4. Outbound guard   — an agent reply to the synthetic customer's chat id
 *                         (a chat Telegram does not know) must fail with 502
 *                         "chat not found" and persist NOTHING — the exact
 *                         regression the fake seed data used to cause.
 *   5. Inbox actions    — assign / unassign / close / reopen smoke tests on
 *                         the omni conversation (no Telegram calls).
 *   6. Real delivery    — OPT-IN (E2E_REAL_DELIVERY=1): also replies through
 *                         a REAL Telegram conversation, verifying the full
 *                         outbound leg end to end. Sends one real Telegram
 *                         message per run to the human customer.
 *
 * Artifacts: everything carries a unique MARKER. Cleanup deletes this run's
 * messages / notifications / ledger rows. The synthetic customer
 * ("E2E BotCustomer") is kept as a standing fixture after its first run so
 * later runs reuse the same contact + conversation.
 *
 * Requirements:
 *   - a running backend (REST + WS on :8080 by default) with seeded demo users
 *   - TELEGRAM_BOT_TOKEN configured in server/.env (bot must authenticate)
 *   - server/dist built (DB ground-truth checks import the connection module)
 *
 * Usage:
 *   npm run test:e2e:telegram
 *   API_BASE=http://host:8080 node e2e/telegram-omni.e2e.js
 *   node e2e/telegram-omni.e2e.js --keep              # leave artifacts
 *   E2E_REAL_DELIVERY=1 node e2e/telegram-omni.e2e.js # + real outbound leg
 *
 * Exit code 0 = all checks passed.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const WebSocket = require('ws');

const API_BASE = process.env.API_BASE || 'http://localhost:8080';
const WS_URL = process.env.WS_URL || 'ws://localhost:8080';
const KEEP = process.argv.includes('--keep');
const REAL_DELIVERY = process.env.E2E_REAL_DELIVERY === '1';

const AGENT_EMAIL = process.env.E2E_AGENT_EMAIL || 'admin@kneachat.com';
const PASSWORD = process.env.E2E_PASSWORD || 'kneachat168';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

// The synthetic customer the webhook posts as. A FIXED external id so the
// first run creates the contact/conversation and later runs reuse it.
const TG_CUSTOMER_ID = process.env.E2E_TG_CUSTOMER_ID || '700000001';
const CUSTOMER_FIRST = 'E2E';
const CUSTOMER_LAST = 'BotCustomer';
const CUSTOMER_NAME_PREFIX = `${CUSTOMER_FIRST} ${CUSTOMER_LAST} (Telegram)`;

// Unique per run so cleanup only ever touches this run's artifacts.
const MARKER = `e2e-${process.pid}-${Date.now()}`;
const INBOUND_CONTENT = `e2e inbound ${MARKER} hello`;

// The synthetic customer's chat id does not exist on Telegram's servers, so a
// leftover fixture would 502 on every agent reply ("chat not found"). Teardown
// therefore removes the whole fixture by default; opt out for repeat runs with
// E2E_KEEP_FIXTURE=1.
const KEEP_FIXTURE = process.env.E2E_KEEP_FIXTURE === '1';

// ---------------------------------------------------------------------------
// Tiny test harness (same shape as notifications.e2e.js)
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

async function api(pathname, { method = 'GET', token, body, headers } = {}) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
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

/** Read-only Telegram Bot API call (no secrets logged, nothing mutated). */
async function telegramApi(method) {
  if (!BOT_TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`);
    return await res.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// WebSocket helpers (same shape as notifications.e2e.js)
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
// Conversation lookup helpers
// ---------------------------------------------------------------------------
async function listTelegramConversations(token) {
  const { json } = await api('/api/conversations', { token });
  return (json?.data?.conversations || []).filter((c) => c.channel === 'telegram');
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------
async function main() {
  console.log('KneaChat E2E — Telegram omni-channel inbox');
  console.log(`  API : ${API_BASE}`);
  console.log(`  WS  : ${WS_URL}`);
  console.log(`  mark: ${MARKER}${KEEP ? '  (--keep: leaving artifacts)' : ''}`);
  if (REAL_DELIVERY) console.log('  real delivery: ENABLED (will send one real Telegram message)');

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
    console.log('     Start the backend first: cd server && npm run dev');
    process.exit(1);
  }
  console.log('  ✅ Server is up');

  // 1. Authenticate the agent.
  section('Authentication');
  const agent = await login(AGENT_EMAIL);
  console.log(`  ✅ ${AGENT_EMAIL} (agent) — id ${agent.user?.id}`);
  if (!agent.user?.id) throw new Error('Login payload missing user id');

  // 2. Channel health — the bot token must work against the Telegram API.
  section('Telegram channel health');
  const omniHealth = await api('/api/omni/health/telegram');
  const connected = omniHealth.json?.connected === true;
  check(
    `channel health reports connected (HTTP ${omniHealth.status})`,
    connected,
    JSON.stringify(omniHealth.json),
  );
  if (omniHealth.json?.info?.bot?.username) {
    console.log(`  ℹ️  bot: @${omniHealth.json.info.bot.username}`);
  }
  if (!connected) {
    console.log('     Set TELEGRAM_BOT_TOKEN in server/.env and restart the backend.');
    process.exit(1);
  }

  // 3. Webhook configuration (read-only ground truth from Telegram).
  section('Webhook configuration');
  const hookInfo = await telegramApi('getWebhookInfo');
  if (!hookInfo) {
    console.log('  ⚠  TELEGRAM_BOT_TOKEN not available to the script — skipping getWebhookInfo');
  } else if (hookInfo.ok && hookInfo.result?.url) {
    check('a public webhook URL is registered', true, hookInfo.result.url);
    console.log(`  ℹ️  ${hookInfo.result.url}`);
    if (hookInfo.result.last_error_message) {
      console.log(`  ⚠  last delivery error: ${hookInfo.result.last_error_message}`);
    }
    if (Number(hookInfo.result.pending_update_count) > 0) {
      console.log(`  ⚠  ${hookInfo.result.pending_update_count} update(s) pending at Telegram`);
    }
  } else {
    // Polling mode: the launchd-managed bridge (scripts/telegram-poll-bridge.js)
    // removes the webhook BY DESIGN and feeds updates into the local webhook
    // endpoint — a registered URL is not required for updates to flow.
    const bridgeRunning = await new Promise((resolve) => {
      require('child_process').execFile('pgrep', ['-f', 'telegram-poll-bridge'], (err, stdout) => {
        resolve(!err && String(stdout).trim().length > 0);
      });
    });
    if (bridgeRunning) {
      check('updates flowing via polling bridge (no webhook — by design)', true, 'telegram-poll-bridge process detected');
    } else {
      check(
        'a public webhook URL is registered (or the polling bridge is running)',
        false,
        'no webhook set and no bridge process — see docs/TELEGRAM_INTEGRATION.md',
      );
    }
  }

  // 4. Locate the omni conversations. The synthetic customer's conversation is
  //    reused across runs; a REAL one (a human who messaged the bot) is needed
  //    only for the opt-in real-delivery leg.
  section('Omni conversations');
  let convs = await listTelegramConversations(agent.token);
  let synthetic = convs.find(
    (c) => typeof c.name === 'string' && c.name.startsWith(CUSTOMER_NAME_PREFIX),
  );
  const existedBefore = !!synthetic;
  check(
    `synthetic customer conversation ${existedBefore ? 'reused' : 'will be created'} (${CUSTOMER_NAME_PREFIX})`,
    true,
  );

  const real = convs.find((c) => c.id !== synthetic?.id);
  if (REAL_DELIVERY) {
    check('a REAL Telegram conversation exists for the delivery leg', !!real, 'message @KneaChatBot once from a real Telegram account');
  } else {
    console.log(`  ℹ️  ${real ? `${convs.length - (existedBefore ? 1 : 0)} real` : 'no'} Telegram conversation(s) besides the synthetic one (real-delivery leg is opt-in: E2E_REAL_DELIVERY=1)`);
  }

  // 5. Connect the agent socket BEFORE the inbound POST so the realtime
  //    fan-out can be observed.
  section('WebSocket session');
  const agentWs = await connectSocket(agent.token);
  await sleep(600);
  check('agent socket connected', !!agentWs);

  // 6. Inbound pipeline — POST a synthetic Telegram update to the webhook.
  section('Inbound: synthetic Telegram webhook');
  const updateId = 900000000 + (Date.now() % 90000000); // unique-ish per run
  const externalMessageId = Date.now() % 2000000000; // ledger unique key per run
  const payload = {
    update_id: updateId,
    message: {
      message_id: externalMessageId,
      from: {
        id: Number(TG_CUSTOMER_ID),
        is_bot: false,
        first_name: CUSTOMER_FIRST,
        last_name: CUSTOMER_LAST,
        username: 'e2e_bot_customer',
      },
      chat: { id: Number(TG_CUSTOMER_ID), first_name: CUSTOMER_FIRST, last_name: CUSTOMER_LAST, type: 'private' },
      date: Math.floor(Date.now() / 1000),
      text: INBOUND_CONTENT,
    },
  };
  const hookPost = await api('/api/telegram/webhook', {
    method: 'POST',
    body: payload,
    headers: WEBHOOK_SECRET ? { 'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET } : {},
  });
  if (hookPost.status === 401) {
    check('webhook accepts the configured secret token', false, 'HTTP 401 — TELEGRAM_WEBHOOK_SECRET mismatch');
    process.exit(1);
  }
  check(`webhook acknowledges the update (HTTP ${hookPost.status})`, hookPost.status === 200);

  // The webhook handler awaits processInbound before acking — no polling needed.
  convs = await listTelegramConversations(agent.token);
  synthetic = convs.find(
    (c) => typeof c.name === 'string' && c.name.startsWith(CUSTOMER_NAME_PREFIX),
  );
  const convId = Number(synthetic?.id);
  check('synthetic customer conversation exists after webhook', Number.isFinite(convId) && convId > 0);

  const { json: msgList } = await api(`/api/conversations/${convId}/messages`, { token: agent.token });
  const messages = msgList?.data?.messages || msgList?.data || [];
  const inbound = (Array.isArray(messages) ? messages : []).find(
    (m) => typeof m.content === 'string' && m.content.includes(MARKER),
  );
  check('inbound message persisted with the run marker', !!inbound, INBOUND_CONTENT);
  check(
    'inbound message is attributed to the customer (not an agent)',
    !!inbound && inbound.first_name === CUSTOMER_FIRST && inbound.last_name === CUSTOMER_LAST,
    inbound ? `${inbound.first_name} ${inbound.last_name}` : 'missing',
  );

  const recv = await waitFor(
    agentWs.events,
    (e) =>
      e.type === 'receive_message' &&
      Number(e.message?.conversationId) === convId &&
      String(e.message?.content || '').includes(MARKER),
  );
  check('agent receives receive_message over WebSocket (real-time render)', !!recv);
  check('receive_message carries the telegram channel tag', recv?.channel === 'telegram', recv?.channel);

  const notif = await waitFor(
    agentWs.events,
    (e) => e.type === 'notification' && e.data?.type === 'new_message' && Number(e.data?.conversationId) === convId,
  );
  check('agent receives new_message notification event (toast/badge path)', !!notif);

  // DB ground truth: the external ledger must record it as inbound/customer.
  const db = await openDb();
  if (db) {
    const rows = await safeQuery(
      db,
      'SELECT direction, sender_type, external_message_id, channel FROM external_messages WHERE message_id = ?',
      [inbound?.id],
    );
    const ledger = rows[0];
    check(
      'external ledger row: direction=inbound, sender_type=customer, channel=telegram',
      !!ledger &&
        ledger.direction === 'inbound' &&
        ledger.sender_type === 'customer' &&
        ledger.channel === 'telegram',
      JSON.stringify(ledger),
    );
    check(
      'external ledger carries the provider message id',
      !!ledger && String(ledger.external_message_id) === String(externalMessageId),
      ledger?.external_message_id,
    );
  }

  // 7. Outbound guard — replying to the synthetic (unknown) chat must fail.
  section('Outbound: reply to an unknown chat (must not persist)');
  const badReply = await api(`/api/omni/conversations/${convId}/messages`, {
    method: 'POST',
    token: agent.token,
    body: { text: `e2e outbound should fail ${MARKER}` },
  });
  check('reply to an unregistered Telegram chat is rejected with 502', badReply.status === 502, `HTTP ${badReply.status}`);
  check(
    'error surfaces the Telegram reason (chat not found)',
    /chat not found/i.test(String(badReply.json?.message || '')),
    badReply.json?.message,
  );

  const badPersist = await api(`/api/conversations/${convId}/messages`, { token: agent.token });
  const badMessages = badPersist.json?.data?.messages || badPersist.json?.data || [];
  const leaked = (Array.isArray(badMessages) ? badMessages : []).find(
    (m) => typeof m.content === 'string' && m.content.includes(`should fail ${MARKER}`),
  );
  check('failed delivery persisted nothing (deliver-before-persist contract)', !leaked);

  // Delivery health (migration 028): the failed reply must have flagged the
  // conversation for the inbox.
  const flagged = (await listTelegramConversations(agent.token)).find((c) => c.id === convId);
  check(
    'failed reply flags the conversation (delivery_fail_count >= 1)',
    Number(flagged?.delivery_fail_count ?? 0) >= 1,
    `count=${flagged?.delivery_fail_count}`,
  );
  check(
    'flag carries the provider error (chat not found)',
    /chat not found/i.test(String(flagged?.last_delivery_error || '')),
    flagged?.last_delivery_error,
  );

  // 8. Inbox actions — assignment + status + delivery-health recovery
  //    (no Telegram calls involved).
  section('Inbox actions: assignment + status');
  const assign = await api(`/api/omni/conversations/${convId}/assign`, {
    method: 'POST',
    token: agent.token,
    body: {},
  });
  check(
    'assign claims the conversation for the requesting agent',
    assign.status === 200 && Number(assign.json?.data?.assignedAgentId) === Number(agent.user.id),
    JSON.stringify(assign.json?.data),
  );
  const unassign = await api(`/api/omni/conversations/${convId}/assign`, {
    method: 'DELETE',
    token: agent.token,
  });
  check('unassign clears the assignment', unassign.status === 200 && assign.json?.data && unassign.json?.data?.assignedAgentId === null, JSON.stringify(unassign.json?.data));

  const close = await api(`/api/omni/conversations/${convId}/status`, {
    method: 'PATCH',
    token: agent.token,
    body: { status: 'closed' },
  });
  check('close the conversation', close.status === 200 && close.json?.data?.status === 'closed');

  // Recovery: new inbound activity on a closed conversation reopens it AND
  // proves the customer's chat is reachable — the failure flag must clear.
  section('Delivery-health recovery: inbound reopens + clears the flag');
  const recoveryContent = `e2e recovery ${MARKER} inbound again`;
  const recoveryHook = await api('/api/telegram/webhook', {
    method: 'POST',
    body: {
      update_id: updateId + 1,
      message: {
        ...payload.message,
        message_id: externalMessageId + 1,
        date: Math.floor(Date.now() / 1000),
        text: recoveryContent,
      },
    },
    headers: WEBHOOK_SECRET ? { 'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET } : {},
  });
  check(`recovery webhook acknowledged (HTTP ${recoveryHook.status})`, recoveryHook.status === 200);

  const recovered = (await listTelegramConversations(agent.token)).find((c) => c.id === convId);
  check(
    'inbound activity reopens the closed conversation',
    recovered?.external_status === 'open',
    `status=${recovered?.external_status}`,
  );
  check(
    'delivery-failure flag cleared on reopen (delivery_fail_count = 0)',
    Number(recovered?.delivery_fail_count ?? 0) === 0,
    `count=${recovered?.delivery_fail_count}`,
  );

  // Leave the conversation as found (open) — the recovery webhook did that.

  // 9. (Opt-in) Real outbound delivery through a real Telegram conversation.
  if (REAL_DELIVERY) {
    section('Outbound: real delivery (opt-in)');
    const realId = Number(real?.id);
    if (Number.isFinite(realId) && realId > 0) {
      const text = `[E2E ${MARKER}] Omni inbox real-delivery check`;
      const reply = await api(`/api/omni/conversations/${realId}/messages`, {
        method: 'POST',
        token: agent.token,
        body: { text },
      });
      check(
        'agent reply through a real conversation delivers (HTTP 201)',
        reply.status === 201 && !!reply.json?.data?.message?.id,
        `HTTP ${reply.status} ${reply.json?.message || ''}`,
      );
      if (reply.json?.data?.message?.id && db) {
        const rows = await safeQuery(
          db,
          'SELECT direction, sender_type FROM external_messages WHERE message_id = ?',
          [reply.json.data.message.id],
        );
        check(
          'real reply recorded in the ledger as outbound/agent',
          rows[0]?.direction === 'outbound' && rows[0]?.sender_type === 'agent',
          JSON.stringify(rows[0]),
        );
      }
    } else {
      check('a REAL Telegram conversation exists for the delivery leg', false, 'message @KneaChatBot once from a real Telegram account first');
    }
  }

  agentWs.ws.close();

  // 10. Cleanup — remove only this run's artifacts (marker-based).
  section('Cleanup');
  await cleanup({ db, convId, existedBefore });

  console.log(`\n${'═'.repeat(60)}`);
  if (failed === 0) {
    console.log(`🎉 ALL CHECKS PASSED (${passed} passed)`);
  } else {
    console.log(`❌ ${failed} check(s) failed, ${passed} passed`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// DB access (best-effort — the API checks above are the primary assertions)
// ---------------------------------------------------------------------------
async function openDb() {
  try {
    let db = require('../dist/src/database/connection');
    db = db.default || db;
    return db;
  } catch {
    console.warn('  ⚠  DB ground-truth checks skipped — dist/database module unavailable (run npm run build)');
    return null;
  }
}

async function safeQuery(db, sql, params) {
  try {
    return await db.query(sql, params);
  } catch (error) {
    console.warn(`  ⚠  DB query failed: ${error.message}`);
    return [];
  }
}

async function cleanup({ db, convId, existedBefore }) {
  if (KEEP) {
    console.log('  (--keep: artifacts left in the DB for inspection)');
    return;
  }
  if (!db) {
    console.warn('  ⚠  DB cleanup skipped — database module unavailable');
    console.warn(`     Remove rows manually by searching for "${MARKER}"`);
    return;
  }
  try {
    const like = `%${MARKER}%`;

    // Notifications carry a content snippet → marker match.
    const notifs = await safeQuery(db, 'SELECT id FROM notifications WHERE message LIKE ?', [like]);
    await safeQuery(db, 'DELETE FROM notifications WHERE message LIKE ?', [like]);

    // This run's messages (inbound + any real-delivery reply). The external
    // ledger cascades on message delete, so one delete covers both tables.
    const msgs = await safeQuery(db, 'SELECT id, sender_id FROM messages WHERE content LIKE ?', [like]);
    await safeQuery(db, 'DELETE FROM messages WHERE content LIKE ?', [like]);

    console.log(
      `  🧹 Removed ${msgs.length} test message(s) + ${notifs.length} notification(s) (marker ${MARKER})`,
    );

    // Fixture teardown — FK-safe order. The synthetic customer cannot receive
    // replies (its chat id is not a real Telegram chat), so leaving it in the
    // inbox only creates "chat not found" 502s for agents.
    if (convId && !KEEP_FIXTURE) {
      // safeQuery returns the ROWS array — do not destructure a row out of it.
      const ecRows = await safeQuery(db, 'SELECT contact_id FROM external_conversations WHERE conversation_id = ?', [convId]);
      const contactId = ecRows?.[0]?.contact_id ?? null;
      let shadowUser = null;
      if (contactId) {
        const cRows = await safeQuery(db, 'SELECT user_id FROM external_contacts WHERE id = ?', [contactId]);
        shadowUser = cRows?.[0]?.user_id ?? null;
      }
      const teardown = [
        ['notifications (shadow user)', 'DELETE FROM notifications WHERE user_id = ? OR actor_id = ?', [shadowUser, shadowUser]],
        ['message_bookmarks', 'DELETE mb FROM message_bookmarks mb JOIN messages m ON m.id = mb.message_id WHERE m.conversation_id = ?', [convId]],
        ['message_reminders', 'DELETE mr FROM message_reminders mr JOIN messages m ON m.id = mr.message_id WHERE m.conversation_id = ?', [convId]],
        ['attachments', 'DELETE a FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.conversation_id = ?', [convId]],
        ['message_reactions', 'DELETE r FROM message_reactions r JOIN messages m ON m.id = r.message_id WHERE m.conversation_id = ?', [convId]],
        ['external_messages', 'DELETE FROM external_messages WHERE conversation_id = ?', [convId]],
        ['messages', 'DELETE FROM messages WHERE conversation_id = ?', [convId]],
        ['conversation_members', 'DELETE FROM conversation_members WHERE conversation_id = ?', [convId]],
        ['external_conversations', 'DELETE FROM external_conversations WHERE conversation_id = ?', [convId]],
        ['external_contacts', 'DELETE FROM external_contacts WHERE id = ?', [contactId]],
        ['conversations', 'DELETE FROM conversations WHERE id = ?', [convId]],
        ['shadow user', 'DELETE FROM users WHERE id = ? AND role = ?', [shadowUser, 'external']],
      ];
      let skipped = 0;
      for (const [what, sql, params] of teardown) {
        if (params.some((p) => p === null || p === undefined)) {
          console.warn(`  ⚠  Fixture teardown skipped "${what}" — missing id (contact/user lookup failed)`);
          skipped++;
          continue;
        }
        await safeQuery(db, sql, params);
      }
      // Verify instead of trusting the deletes — the fixture must be gone.
      const left = await safeQuery(db, 'SELECT COUNT(*) AS n FROM conversations WHERE id = ?', [convId]);
      if ((left?.[0]?.n ?? 1) === 0 && skipped === 0) {
        console.log(`  🧹 Removed synthetic fixture: conversation ${convId} (${CUSTOMER_NAME_PREFIX})`);
      } else {
        console.warn(`  ⚠  Fixture teardown incomplete for conversation ${convId} (${skipped} step(s) skipped)`);
      }
    } else if (convId && KEEP_FIXTURE) {
      console.log(`  ℹ️  Kept synthetic fixture: conversation ${convId} (${CUSTOMER_NAME_PREFIX}) for reuse by future runs`);
    }

    await db.pool.end().catch(() => {});
  } catch (error) {
    console.warn(`  ⚠  DB cleanup failed: ${error.message} (rows can be removed manually by searching "${MARKER}")`);
  }
}

main().catch((error) => {
  console.error('\n❌ E2E script error:', error.message);
  process.exit(1);
});
