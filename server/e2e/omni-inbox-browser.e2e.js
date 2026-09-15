#!/usr/bin/env node
/**
 * KneaChat — Omni Inbox delivery-health UI browser E2E (drives a real browser
 * via CDP — same mechanism as search-browser.e2e.js).
 *
 * Verifies the delivery-health flagging (migration 028) end to end in the UI:
 *
 *   1. Login (demo button) → open the Omni Inbox from the sidebar.
 *   2. Baseline: no delivery warnings rendered (rows show channel chips only).
 *   3. Fixture lifecycle: a synthetic Telegram customer is created through the
 *      webhook and an agent reply is attempted (502 "chat not found"), which
 *      flags the conversation server-side. After a reload the UI must show the
 *      "delivery failing" tag + the "N delivery issues" hide toggle, and the
 *      toggle must hide the failing row.
 *   4. The fixture is removed from the DB (FK-safe) and the UI must be back to
 *      zero warnings after a reload.
 *
 * Requirements: backend on :8080 (REST + WS), client on :3000, Chrome,
 * TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET in server/.env, server built
 * (dist database module for cleanup).
 *
 * Usage:
 *   npm run test:e2e:omni-inbox
 *   APP_URL=http://localhost:3000 node e2e/omni-inbox-browser.e2e.js
 *
 * Exit code 0 = all checks passed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const path_ = require('path');
require('dotenv').config({ path: path_.join(__dirname, '..', '.env') });

const WebSocket = require('ws');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const API_BASE = process.env.API_BASE || 'http://localhost:8080';
const DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT || 9333);
const CDP_BASE = `http://127.0.0.1:${DEBUG_PORT}`;
const ACCOUNT_LABEL = process.env.SMOKE_ACCOUNT_LABEL || 'Admin demo';
const AGENT_EMAIL = process.env.E2E_AGENT_EMAIL || 'admin@kneachat.com';
const PASSWORD = process.env.E2E_PASSWORD || 'kneachat168';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

const TG_CUSTOMER_ID = Number(process.env.E2E_TG_CUSTOMER_ID || '700000001');
const CUSTOMER_NAME_PREFIX = 'E2E BotCustomer (Telegram)';

const candidates = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const CHROME = candidates.find((c) => c && fs.existsSync(c));
if (!CHROME) {
  console.error('✗ Chrome not found — set CHROME_BIN to your Chrome executable.');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
const ok = (label) => { passed += 1; console.log(`  ✔ ${label}`); };
const bad = (label, err) => {
  const msg = err && err.message ? err.message : String(err);
  failed += 1;
  console.error(`  ✘ ${label}\n      ${msg.slice(0, 400)}`);
};

// ---------------------------------------------------------------------------
// Launch Chrome + minimal CDP client (same as search-browser.e2e.js)
// ---------------------------------------------------------------------------
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-omni-'));
let chrome;
async function launchChrome() {
  chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--disable-gpu',
    '--window-size=1440,1000',
    'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`${CDP_BASE}/json/version`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome did not open its debugging port');
}

let ws;
const pending = new Map();
const listeners = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = 1 + Math.floor(Math.random() * 1e9);
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
function on(method, fn) {
  if (!listeners.has(method)) listeners.set(method, []);
  listeners.get(method).push(fn);
}

const consoleIssues = [];

async function connect() {
  const res = await fetch(`${CDP_BASE}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  const target = await res.json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = (e) => reject(new Error(`ws error: ${e.message || ''}`));
  });
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(String(data));
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(`${m.error.message || 'CDP error'} ${JSON.stringify(m.error.data || '')}`.trim()));
      else resolve(m.result || {});
      return;
    }
    if (m.method && listeners.has(m.method)) {
      for (const fn of listeners.get(m.method)) fn(m.params || {});
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') {
      const text = (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300);
      consoleIssues.push(`[console.error] ${text}`);
    }
  });
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error(`page eval threw: ${(d.exception?.description || d.text || '').slice(0, 300)}`);
  }
  return r.result && r.result.value;
}

/** Serialize a function with JSON-stringified args into a page expression. */
const run = (fn, ...args) => evaluate(`(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`);

async function waitFor(expr, { timeout = 20000, label = expr } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await evaluate(expr)) return;
    } catch { /* expression may not be valid until the DOM is ready */ }
    await sleep(200);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

const clickNav = (label) => run((navLabel) => {
  const btn = [...document.querySelectorAll('.nav-item')].find((b) => b.textContent.includes(navLabel));
  if (!btn) throw new Error(`nav item not found: ${navLabel}`);
  btn.click();
  return true;
}, label);

/** Omni inbox DOM summary for assertions. */
const inboxState = () => run(() => ({
  h1: document.querySelector('.view-page h1')?.textContent?.trim() || null,
  rows: document.querySelectorAll('.list-card .list-row').length,
  channelChips: [...document.querySelectorAll('.list-card .group-tag')].map((t) => t.textContent.trim()),
  warningTags: document.querySelectorAll('.delivery-warning-tag').length,
  failingRows: document.querySelectorAll('.list-row.delivery-failing').length,
  toggle: document.querySelector('.delivery-toggle')?.textContent?.trim() || null,
  empty: !!document.querySelector('.empty-state'),
}));

// ---------------------------------------------------------------------------
// API helpers (node-side — used to drive the fixture lifecycle)
// ---------------------------------------------------------------------------
async function apiLogin() {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: AGENT_EMAIL, password: PASSWORD }),
  });
  const json = await res.json();
  if (!json?.data?.token) throw new Error(`agent login failed: HTTP ${res.status}`);
  return json.data;
}

async function postWebhook(updateId, messageId, text) {
  const res = await fetch(`${API_BASE}/api/telegram/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(WEBHOOK_SECRET ? { 'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET } : {}),
    },
    body: JSON.stringify({
      update_id: updateId,
      message: {
        message_id: messageId,
        from: { id: TG_CUSTOMER_ID, is_bot: false, first_name: 'E2E', last_name: 'BotCustomer', username: 'e2e_bot_customer' },
        chat: { id: TG_CUSTOMER_ID, type: 'private', first_name: 'E2E', last_name: 'BotCustomer' },
        date: Math.floor(Date.now() / 1000),
        text,
      },
    }),
  });
  return res.status;
}

/** Remove the synthetic fixture rows (FK-safe, guarded, idempotent). */
async function removeFixture() {
  let db = require('../dist/src/database/connection');
  db = db.default || db;
  try {
    const contacts = await db.query(
      "SELECT id, user_id FROM external_contacts WHERE channel='telegram' AND external_contact_id=?",
      [String(TG_CUSTOMER_ID)],
    );
    for (const contact of contacts) {
      const convs = await db.query(
        'SELECT conversation_id FROM external_conversations WHERE contact_id=?',
        [contact.id],
      );
      for (const conv of convs) {
        // actor_id is a RESTRICT FK to users — notifications where the shadow
        // user is the actor must go before the user row.
        await db.query('DELETE FROM notifications WHERE user_id=? OR actor_id=?', [contact.user_id, contact.user_id]);
        await db.query('DELETE FROM messages WHERE conversation_id=?', [conv.conversation_id]);
        await db.query('DELETE FROM conversation_members WHERE conversation_id=?', [conv.conversation_id]);
        await db.query('DELETE FROM external_conversations WHERE conversation_id=?', [conv.conversation_id]);
        await db.query('DELETE FROM conversations WHERE id=?', [conv.conversation_id]);
      }
      await db.query('DELETE FROM external_contacts WHERE id=?', [contact.id]);
      await db.query('DELETE FROM users WHERE id=?', [contact.user_id]);
    }
    // Orphaned shadow users (a contact insert that failed half-way) — matched
    // by the synthetic email pattern so real customers are never touched.
    const orphans = await db.query(
      "SELECT id FROM users WHERE email = ?",
      [`telegram.${TG_CUSTOMER_ID}@external.kneachat.local`],
    );
    for (const orphan of orphans) {
      await db.query('DELETE FROM notifications WHERE user_id=? OR actor_id=?', [orphan.id, orphan.id]);
      await db.query('DELETE FROM users WHERE id=?', [orphan.id]);
    }
    console.log('  🧹 Fixture removed (synthetic customer + conversation)');
  } finally {
    await db.pool.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Using Chrome: ${CHROME}`);
  await launchChrome();
  await connect();
  console.log(`App: ${APP_URL}  ·  account: ${ACCOUNT_LABEL}\n`);

  // ---- 1. Login ----------------------------------------------------------
  await send('Page.navigate', { url: `${APP_URL}/login` });
  try {
    await waitFor(`!!document.querySelector('.auth-demo-btn')`, { label: 'login page demo buttons', timeout: 60000 });
    ok('Login page renders');
  } catch (e) { bad('Login page renders', e); }

  try {
    await evaluate(`(() => {
      const label = ${JSON.stringify(ACCOUNT_LABEL)};
      const b = [...document.querySelectorAll('.auth-demo-btn')].find((x) => x.textContent.includes(label));
      if (!b) throw new Error('demo account button missing: ' + label);
      b.click();
      return true;
    })()`);
    await waitFor(`location.pathname === '/dashboard' && !!document.querySelector('.workspace-shell')`, { label: 'dashboard after login', timeout: 30000 });
    ok(`Logs in as ${ACCOUNT_LABEL} and reaches the dashboard`);
  } catch (e) { bad(`Logs in as ${ACCOUNT_LABEL} and reaches the dashboard`, e); }

  const openInbox = async () => {
    await clickNav('Omni Inbox');
    await waitFor(
      `!!document.querySelector('.view-page h1') && document.querySelector('.view-page h1').textContent.trim() === 'Omni Inbox' && (document.querySelectorAll('.list-card .list-row').length > 0 || !!document.querySelector('.empty-state'))`,
      { label: 'Omni Inbox rendered with rows', timeout: 20000 },
    );
  };

  /** Full app reload; re-logins through the demo button when the session dropped. */
  const reloadApp = async () => {
    await send('Page.navigate', { url: `${APP_URL}/dashboard` });
    const loggedIn = await waitFor(
      `!!document.querySelector('.workspace-shell') || !!document.querySelector('.auth-demo-btn')`,
      { label: 'dashboard or login after reload', timeout: 30000 },
    );
    if (await evaluate(`!!document.querySelector('.auth-demo-btn')`)) {
      await evaluate(`(() => {
        const label = ${JSON.stringify(ACCOUNT_LABEL)};
        const b = [...document.querySelectorAll('.auth-demo-btn')].find((x) => x.textContent.includes(label));
        if (!b) throw new Error('demo account button missing: ' + label);
        b.click();
        return true;
      })()`);
      await waitFor(`location.pathname === '/dashboard' && !!document.querySelector('.workspace-shell')`, { label: 'dashboard after re-login', timeout: 30000 });
    }
  };

  // ---- 2. Baseline: the inbox with the fixture gone ----------------------
  try {
    await openInbox();
    const state = await inboxState();
    ok(`Omni Inbox opens (heading "${state.h1}", ${state.rows} row(s))`);
    if (state.warningTags === 0 && state.failingRows === 0 && !state.toggle) {
      ok('Baseline: no delivery warnings rendered');
    } else {
      bad('Baseline: no delivery warnings rendered', `warningTags=${state.warningTags} failingRows=${state.failingRows} toggle=${state.toggle}`);
    }
  } catch (e) { bad('Omni Inbox baseline', e); }

  // ---- 2b. Composer adapts to the conversation type ----------------------
  // External channels relay files + voice through the channel adapter, so the
  // composer offers the attach + voice controls there too (same as internal).
  try {
    await evaluate(`document.querySelector('.list-card .list-row')?.click()`);
    await waitFor(`!!document.querySelector('.composer-wrap')`, { label: 'composer for a Telegram conversation', timeout: 15000 });
    const extState = await evaluate(`({
      attach: !!document.querySelector('button[title="Attach a file"]'),
      mic: !!document.querySelector('.mic-toggle'),
    })`);
    if (extState.attach && extState.mic) {
      ok('Telegram conversation: composer offers attach + voice (channel relay)');
    } else {
      bad('Telegram conversation: composer offers attach + voice (channel relay)', `attach=${extState.attach} mic=${extState.mic}`);
    }
    await clickNav('Messages');
    await waitFor(`!!document.querySelector('.list-card .list-row, .conversation-list .list-row')`, { label: 'messages list', timeout: 15000 });
    await evaluate(`document.querySelector('.list-card .list-row, .conversation-list .list-row')?.click()`);
    await waitFor(`!!document.querySelector('.composer-wrap') && !!document.querySelector('button[title="Attach a file"]')`, { label: 'internal composer with attach button', timeout: 15000 });
    ok('Internal conversation: composer still offers attach + voice');
    await clickNav('Omni Inbox');
    await waitFor(
      `!!document.querySelector('.view-page h1') && document.querySelector('.view-page h1').textContent.trim() === 'Omni Inbox'`,
      { label: 'back on the omni inbox', timeout: 15000 },
    );
  } catch (e) { bad('Composer file controls adapt to the conversation type', e); }

  // ---- 3. Fixture lifecycle: flag a conversation, watch the UI react -----
  try {
    const agent = await apiLogin();
    // Webhook → fixture find, retried: a transient failure during contact
    // creation is logged-and-ignored by the server, so one extra attempt
    // keeps the run deterministic.
    let fixture = null;
    for (let attempt = 1; attempt <= 2 && !fixture; attempt += 1) {
      const hookStatus = await postWebhook(
        900000000 + (Date.now() % 90000000) + attempt,
        (Date.now() % 2000000000) + attempt,
        `omni ui e2e ${Date.now()}`,
      );
      if (hookStatus !== 200) throw new Error(`webhook POST failed: HTTP ${hookStatus}`);

      const listRes = await fetch(`${API_BASE}/api/conversations`, {
        headers: { Authorization: `Bearer ${agent.token}` },
      });
      const convs = (await listRes.json())?.data?.conversations || [];
      fixture = convs.find((c) => c.channel === 'telegram' && String(c.name || '').startsWith(CUSTOMER_NAME_PREFIX)) || null;
      if (!fixture && attempt < 2) await sleep(1200);
    }
    if (!fixture) throw new Error('fixture conversation not found after webhook (see server log for the swallowed inbound error)');

    // A failed reply flags it server-side (502 — the synthetic chat is unknown).
    const replyRes = await fetch(`${API_BASE}/api/omni/conversations/${fixture.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agent.token}` },
      body: JSON.stringify({ text: 'should fail (unknown chat)' }),
    });
    if (replyRes.status !== 502) throw new Error(`expected 502 for unknown chat, got ${replyRes.status}`);

    // Reload so the store refetches conversations (the fixture was created
    // after the initial page load — SPA state alone would not know it).
    await reloadApp();
    await openInbox();
    await waitFor(`document.querySelectorAll('.delivery-warning-tag').length > 0`, { label: 'delivery warning tag appears', timeout: 15000 });
    let state = await inboxState();
    ok(`Failing conversation flagged in the UI (${state.warningTags} warning tag, toggle: "${state.toggle}")`);

    // The toggle hides failing rows.
    await evaluate(`document.querySelector('.delivery-toggle').click()`);
    await waitFor(`!document.querySelector('.list-row.delivery-failing')`, { label: 'failing rows hidden by toggle', timeout: 10000 });
    state = await inboxState();
    ok(`Hide toggle works (${state.failingRows} failing row(s) visible after toggle)`);

    // Toggle back before teardown so the remaining rows stay visible.
    await evaluate(`document.querySelector('.delivery-toggle').click()`);
  } catch (e) { bad('Fixture lifecycle (flag → UI warning → hide toggle)', e); }

  // ---- 4. Teardown + verify the warnings are gone again ------------------
  try {
    await removeFixture();
    // Full reload so the store refetches conversations — the SPA's in-memory
    // list still contains the (now deleted) flagged fixture otherwise.
    await reloadApp();
    await openInbox();
    const state = await inboxState();
    if (state.warningTags === 0 && state.failingRows === 0 && !state.toggle) {
      ok('After teardown: no delivery warnings rendered');
    } else {
      bad('After teardown: no delivery warnings rendered', `warningTags=${state.warningTags} failingRows=${state.failingRows} toggle=${state.toggle}`);
    }
  } catch (e) { bad('Teardown + re-verify', e); }

  // ---- 5. Console health --------------------------------------------------
  try {
    const realErrors = consoleIssues.filter((t) => !/quillbot|chrome-extension/i.test(t));
    if (realErrors.length === 0) ok('No console errors during the flow');
    else bad('No console errors during the flow', realErrors.slice(0, 3).join(' | '));
  } catch (e) { bad('Console check', e); }

  try { chrome && chrome.kill(); } catch { /* ignore */ }

  console.log(`\n${'═'.repeat(60)}`);
  if (failed === 0) {
    console.log(`🎉 ALL CHECKS PASSED (${passed} passed)`);
  } else {
    console.log(`❌ ${failed} check(s) failed, ${passed} passed`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\n❌ E2E script error:', error.message);
  try { chrome && chrome.kill(); } catch { /* ignore */ }
  process.exit(1);
});
