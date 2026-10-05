#!/usr/bin/env node
/**
 * KneaChat — End-to-end test: the complete email loop through Mailpit
 * (Phase 12). No real mailbox, no real provider.
 *
 *   1. Customer email  → POST /api/webhooks/email (signed)   → MySQL
 *                      → WebSocket `email.message.received` → agent
 *   2. Agent opens it  → GET /api/omni/conversations/:id/messages
 *   3. Agent replies   → POST /api/omni/email/send → Nodemailer → Mailpit SMTP
 *                      → delivery_status 'sent'; Mailpit shows Subject "Re: …",
 *                        In-Reply-To / References = the customer's Message-ID
 *   4. Customer replies to the AGENT's email (In-Reply-To = our Message-ID,
 *      different subject) → lands in the SAME conversation
 *   5. Guards          → unsigned webhook 401, client-supplied recipient 400
 *
 * Mailpit only CATCHES mail: this proves the backend builds and hands over the
 * right email, not that a real provider would deliver it.
 *
 * Requirements:
 *   - Mailpit running:            npm run mailpit   (SMTP :1025, UI/API :8025)
 *   - backend using Mailpit SMTP: EMAIL_SMTP_HOST=localhost EMAIL_SMTP_PORT=1025
 *     EMAIL_SMTP_SECURE=false, empty EMAIL_SMTP_USER/PASS, EMAIL_INBOUND_ENABLED=true
 *   - EMAIL_WEBHOOK_SECRET set in server/.env (the script signs with it)
 *   - server/dist built (cleanup imports the DB module)
 *
 * Usage:
 *   npm run test:e2e:mailpit
 *   API_BASE=http://localhost:8099 WS_URL=ws://localhost:8099 node e2e/email-mailpit.e2e.js
 *   node e2e/email-mailpit.e2e.js --keep        # leave rows + Mailpit messages
 *
 * Exit code 0 = all checks passed.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const crypto = require('crypto');
const WebSocket = require('ws');

const API_BASE = process.env.API_BASE || 'http://localhost:8080';
const WS_URL = process.env.WS_URL || 'ws://localhost:8080';
const MAILPIT_API = process.env.MAILPIT_API || 'http://localhost:8025';
const KEEP = process.argv.includes('--keep');

const AGENT_EMAIL = process.env.E2E_AGENT_EMAIL || 'admin@kneachat.com';
const PASSWORD = process.env.E2E_PASSWORD || 'kneachat168';
const WEBHOOK_SECRET = process.env.EMAIL_WEBHOOK_SECRET || '';

const CUSTOMER_EMAIL = 'e2e-mailpit-customer@external.test';
const INBOX_ADDRESS = 'support@kneachat.local';

// Unique per run: every row and every Mailpit message carries it.
const MARKER = `mailpit-e2e-${process.pid}-${Date.now()}`;
const SUBJECT = `Order problem ${MARKER}`;
const CUSTOMER_MESSAGE_ID = `${MARKER}-1@customer.test`;

let passed = 0;
let failed = 0;
const mailpitIds = [];

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

/** Mailgun-style inbound payload, signed with the generic HMAC scheme. */
function inboundPayload({ messageId, subject, content, inReplyTo, references }) {
  const headers = [
    ['Message-Id', `<${messageId}>`],
    ['From', `E2E Customer <${CUSTOMER_EMAIL}>`],
    ['To', INBOX_ADDRESS],
    ['Subject', subject],
    ...(inReplyTo ? [['In-Reply-To', `<${inReplyTo}>`]] : []),
    ...(references ? [['References', references]] : []),
  ];
  return JSON.stringify({
    recipient: INBOX_ADDRESS,
    sender: CUSTOMER_EMAIL,
    from: `E2E Customer <${CUSTOMER_EMAIL}>`,
    subject,
    'body-plain': content,
    'message-headers': JSON.stringify(headers),
    timestamp: Math.floor(Date.now() / 1000),
  });
}

function postWebhook(body, { signed = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (signed) {
    headers['X-Email-Webhook-Secret'] = WEBHOOK_SECRET;
    headers['X-Email-Signature'] = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('base64');
  }
  return fetch(`${API_BASE}/api/webhooks/email`, { method: 'POST', headers, body });
}

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

/** Poll `fn` until it returns a truthy value, or null after the timeout. */
async function pollFor(fn, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await sleep(150);
  }
  return null;
}

/** Mailpit messages whose subject carries this run's marker. */
async function findMailpitMessages() {
  const res = await fetch(`${MAILPIT_API}/api/v1/search?query=${encodeURIComponent(`subject:"${MARKER}"`)}`);
  const json = await res.json();
  return json.messages || [];
}

async function main() {
  section('Preflight');
  if (!check('EMAIL_WEBHOOK_SECRET is set in server/.env', !!WEBHOOK_SECRET)) return;
  const mailpitUp = await fetch(`${MAILPIT_API}/api/v1/info`).then((r) => r.ok).catch(() => false);
  if (!check(`Mailpit reachable at ${MAILPIT_API}`, mailpitUp, 'run: npm run mailpit')) return;
  const health = await fetch(`${API_BASE}/api/email/health`).then((r) => r.json()).catch(() => null);
  if (!check('Backend SMTP connected (Mailpit)', health?.info?.smtpConnected === true,
    'point EMAIL_SMTP_HOST/PORT at Mailpit and restart the backend')) return;

  const login = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: AGENT_EMAIL, password: PASSWORD }),
  }).then((r) => r.json());
  const token = login?.data?.token;
  if (!check(`Agent ${AGENT_EMAIL} logged in`, !!token)) return;
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const { ws, events } = await connectSocket(token);

  // 1 ── Customer email arrives ───────────────────────────────────────────
  section('1. Customer email → webhook → MySQL → WebSocket');
  const inboundText = `Where is my order? ${MARKER}`;
  const hook = await postWebhook(inboundPayload({ messageId: CUSTOMER_MESSAGE_ID, subject: SUBJECT, content: inboundText }));
  check('POST /api/webhooks/email → 200', hook.status === 200, `HTTP ${hook.status}`);
  const received = await pollFor(() => events.find((e) => e.type === 'email.message.received' && e.message?.content === inboundText));
  if (!check('Agent got email.message.received over WebSocket', !!received)) return;
  const conversationId = received.conversationId;
  check('Event carries subject + sender', received.email?.subject === SUBJECT && received.email?.from === CUSTOMER_EMAIL,
    JSON.stringify(received.email));

  // 2 ── Agent opens the conversation ─────────────────────────────────────
  section('2. Agent opens the conversation');
  const history = await fetch(`${API_BASE}/api/omni/conversations/${conversationId}/messages`, { headers: auth }).then((r) => r.json());
  check('GET /api/omni/conversations/:id/messages contains the email',
    (history?.data?.messages || []).some((m) => m.content === inboundText));

  // 3 ── Agent replies through Nodemailer → Mailpit ───────────────────────
  section('3. Agent reply → Nodemailer → Mailpit');
  const replyText = `It ships today. ${MARKER}`;
  const sendRes = await fetch(`${API_BASE}/api/omni/email/send`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ conversationId, text: replyText }),
  });
  const sendJson = await sendRes.json().catch(() => null);
  check('POST /api/omni/email/send → 201', sendRes.status === 201, `HTTP ${sendRes.status} ${JSON.stringify(sendJson)}`);
  check("Reply stored with delivery_status 'sent'", sendJson?.data?.message?.delivery_status === 'sent',
    String(sendJson?.data?.message?.delivery_status));

  const caught = await pollFor(async () => (await findMailpitMessages())[0]);
  if (!check('Mailpit caught the reply', !!caught)) return;
  mailpitIds.push(caught.ID);
  const headers = await fetch(`${MAILPIT_API}/api/v1/message/${caught.ID}/headers`).then((r) => r.json());
  const header = (name) => (headers[name] || [])[0] || '';
  check('To = the customer', header('To').includes(CUSTOMER_EMAIL), header('To'));
  check(`Subject = "Re: ${SUBJECT}"`, header('Subject') === `Re: ${SUBJECT}`, header('Subject'));
  check("In-Reply-To = the customer's Message-ID", header('In-Reply-To') === `<${CUSTOMER_MESSAGE_ID}>`, header('In-Reply-To'));
  check('References includes it', header('References').includes(`<${CUSTOMER_MESSAGE_ID}>`), header('References'));
  const agentMessageId = header('Message-Id').replace(/[<>]/g, '');
  check('Reply has its own Message-ID', !!agentMessageId);

  // 4 ── Customer answers the agent's email ───────────────────────────────
  section("4. Customer replies to the agent's email");
  const followUpText = `Thanks, got it! ${MARKER}`;
  await postWebhook(inboundPayload({
    messageId: `${MARKER}-2@customer.test`,
    subject: `A completely different subject ${MARKER}`, // only the headers can thread it
    content: followUpText,
    inReplyTo: agentMessageId,
  }));
  const followUp = await pollFor(() => events.find((e) => e.type === 'email.message.received' && e.message?.content === followUpText));
  check('Follow-up arrived over WebSocket', !!followUp);
  check('…in the SAME conversation (matched via our outbound Message-ID)', followUp?.conversationId === conversationId,
    `got ${followUp?.conversationId}, expected ${conversationId}`);

  // 5 ── Guards ────────────────────────────────────────────────────────────
  section('5. Security guards');
  const unsigned = await postWebhook(inboundPayload({ messageId: `${MARKER}-3@customer.test`, subject: SUBJECT, content: 'forged' }), { signed: false });
  check('Unsigned webhook → 401', unsigned.status === 401, `HTTP ${unsigned.status}`);
  const hijack = await fetch(`${API_BASE}/api/omni/email/send`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ conversationId, text: 'hi', to: 'attacker@evil.test' }),
  });
  check('Client-supplied recipient → 400', hijack.status === 400, `HTTP ${hijack.status}`);

  ws.close();
}

async function cleanup() {
  if (mailpitIds.length) {
    await fetch(`${MAILPIT_API}/api/v1/messages`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ IDs: mailpitIds }),
    }).catch(() => {});
  }
  let db;
  try {
    db = require('../dist/src/database/connection').default;
  } catch {
    console.warn(`  ⚠  DB cleanup skipped — remove rows for ${CUSTOMER_EMAIL} manually`);
    return;
  }
  const q = (sql, params) => db.query(sql, params).catch((e) => console.warn(`    (cleanup query failed: ${e.message})`));
  const contacts = (await q("SELECT id, user_id FROM external_contacts WHERE channel = 'email' AND email_address = ?", [CUSTOMER_EMAIL])) || [];
  for (const contact of contacts) {
    const convs = (await q('SELECT conversation_id FROM external_conversations WHERE contact_id = ?', [contact.id])) || [];
    for (const { conversation_id: convId } of convs) {
      // FK-safe order; email_messages / external_messages cascade from messages.
      await q('DELETE n FROM notifications n WHERE n.message LIKE ?', [`%${MARKER}%`]);
      await q('DELETE FROM notifications WHERE user_id = ? OR actor_id = ?', [contact.user_id, contact.user_id]);
      await q('DELETE a FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.conversation_id = ?', [convId]);
      await q('DELETE FROM messages WHERE conversation_id = ?', [convId]);
      await q('DELETE FROM conversation_members WHERE conversation_id = ?', [convId]);
      await q('DELETE FROM external_conversations WHERE conversation_id = ?', [convId]);
      await q('DELETE FROM conversations WHERE id = ?', [convId]);
    }
    await q('DELETE FROM external_contacts WHERE id = ?', [contact.id]);
    await q("DELETE FROM users WHERE id = ? AND role = 'external'", [contact.user_id]);
  }
  console.log(`\n  🧹 Removed the test customer, its conversations and ${mailpitIds.length} Mailpit message(s)`);
  await db.pool.end().catch(() => {});
}

let exitCode = 0;
main()
  .catch((error) => {
    console.error('\n❌ E2E script error:', error.message);
    exitCode = 1;
  })
  .finally(async () => {
    if (!KEEP) await cleanup();
    console.log(`\n${failed === 0 && exitCode === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : exitCode);
  });
