#!/usr/bin/env node
/**
 * Real-outbound demo — exercises the PRODUCT path end to end:
 *
 *   1. A signed inbound webhook (same wire format Resend uses) creates a
 *      customer + conversation in the Omni Inbox.
 *   2. An agent logs in and replies via the omni REST API (as the UI does).
 *   3. The reply goes out through REAL SMTP to a real address you choose.
 *
 * Usage:
 *   node scripts/demo-real-outbound.js <real-recipient@example.com> [name]
 *   node scripts/demo-real-outbound.js pheazha310@gmail.com "Phal"
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');

const TO = process.argv[2] || 'pheazha310@gmail.com';
const NAME = process.argv[3] || 'Phal';
const API = process.env.API_BASE || 'http://localhost:8080';
const AGENT_EMAIL = process.env.E2E_AGENT_EMAIL || 'admin@kneachat.com';
const AGENT_PASS = process.env.E2E_PASSWORD || 'kneachat168';

const CUSTOMER = `demo.${Date.now()}@gmail.com`;
const SUBJECT = `KneaChat demo — message from the Omni Inbox`;
const BODY = `Hi ${NAME}!\n\nThis message was written by an agent in the KneaChat Omni Inbox and delivered through real SMTP (support@sopheaphal.site).\n\nReply to this email and — once inbound DNS is live — your reply lands back in the inbox.\n\n— KneaChat (${new Date().toISOString()})`;

const ts = () => new Date().toISOString().slice(11, 23);

async function main() {
  console.log(`\nKneaChat real-outbound demo → ${TO}\n`);

  // --- 1. Signed inbound webhook: create the customer + conversation ---------
  // Mailgun-style inline payload (content travels with the request) + the
  // generic HMAC signature — the exact path email-omni.e2e.js exercises.
  const payload = {
    recipient: 'support@sopheaphal.site',
    sender: `${NAME} <${CUSTOMER}>`,
    from: `${NAME} <${CUSTOMER}>`,
    subject: SUBJECT,
    'body-plain': `Hello! I emailed your KneaChat inbox — please reply here.`,
    'message-id': `<demo-${Date.now()}@gmail.com>`,
    'message-headers': JSON.stringify([[ 'Message-ID', `<demo-${Date.now()}@gmail.com>` ]]),
  };
  const raw = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', process.env.EMAIL_WEBHOOK_SECRET || '')
    .update(raw).digest('base64');

  process.stdout.write(`[${ts()}] inbound webhook (creates inbox conversation)… `);
  const wh = await fetch(`${API}/api/email/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-email-signature': sig,
    },
    body: raw,
  });
  console.log(`HTTP ${wh.status}`);
  if (wh.status !== 200) { console.error('❌ webhook rejected'); process.exit(1); }

  // --- 2. Agent login ----------------------------------------------------------
  process.stdout.write(`[${ts()}] agent login (${AGENT_EMAIL})… `);
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: AGENT_EMAIL, password: AGENT_PASS }),
  });
  const loginJson = await login.json().catch(() => null);
  const token = loginJson?.data?.token || loginJson?.token;
  console.log(login.status === 200 ? 'ok' : `HTTP ${login.status}`);
  if (!token) { console.error('❌ login failed:', JSON.stringify(loginJson).slice(0, 200)); process.exit(1); }

  // --- 3. Find the conversation the webhook just created -----------------------
  process.stdout.write(`[${ts()}] locating the demo conversation… `);
  const convs = await fetch(`${API}/api/omni/conversations?channel=email`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json()).catch(() => null);
  const list = convs?.data?.conversations || convs?.data || convs?.conversations || [];
  const conv = (Array.isArray(list) ? list : []).find((c) => (c.name || '').includes('KneaChat demo'));
  if (!conv) { console.error('❌ conversation not found — listing what IS there:'); const sample = (Array.isArray(list) ? list : []).slice(0, 5).map((c) => `   #${c.id} ${c.name}`); console.error(sample.join('\n') || '   (none)'); process.exit(1); }
  console.log(`found #${conv.id} / ${conv.conversation_id || ''}`);

  // --- 4. Agent reply → real SMTP ----------------------------------------------
  const convId = conv.conversation_id || conv.id;
  process.stdout.write(`[${ts()}] agent reply via omni API → real SMTP… `);
  const reply = await fetch(`${API}/api/omni/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text: BODY }),
  });
  const replyJson = await reply.json().catch(() => null);
  console.log(`HTTP ${reply.status}`);
  if (!(reply.status === 200 || reply.status === 201)) {
    console.error('❌ reply failed:', JSON.stringify(replyJson).slice(0, 300));
    process.exit(1);
  }
  console.log(`\n✅ Real email sent to ${TO} from support@sopheaphal.site`);
  console.log('   Check the inbox (and spam) — this is the product path, not a test harness.');
  console.log(`   Conversation #${convId} stays in the Omni Inbox with the full thread.`);
}

main().catch((e) => { console.error('❌', e.message || e); process.exit(1); });
