#!/usr/bin/env node
/**
 * Live-check the email webhook's Resend (Svix) signature verification against
 * a running backend — no real Resend account needed.
 *
 * Sends two deliveries to the configured webhook URL:
 *   1. a correctly Svix-signed `email.received` event  → expected HTTP 200
 *   2. the same event with a tampered body             → expected HTTP 401
 *
 * The test event carries a random email_id and no attachments; with
 * EMAIL_RESEND_API_KEY unset the adapter cannot fetch a body and the valid
 * delivery is acknowledged (200) without persisting anything — the check is
 * side-effect free on the inbox.
 *
 * The signing secret is read from EMAIL_RESEND_WEBHOOK_SECRET (or
 * EMAIL_WEBHOOK_SECRET) in server/.env — never printed or logged.
 *
 * Usage:
 *   npm run resend:check
 *   EMAIL_WEBHOOK_URL=https://<tunnel-host>/api/email/webhook node scripts/resend-webhook-check.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const crypto = require('crypto');

const WEBHOOK_PATH = '/api/email/webhook';
const whsec = process.env.EMAIL_RESEND_WEBHOOK_SECRET || process.env.EMAIL_WEBHOOK_SECRET || '';
const webhookUrl = process.argv[2] || process.env.EMAIL_WEBHOOK_URL || '';

function svixHeaders(rawBody, secret) {
  const id = `msg_check_${Date.now()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signature = `v1,${crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64')}`;
  return {
    'content-type': 'application/json',
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': signature,
  };
}

/**
 * POST `sentBody` with a Svix signature computed over `signedBody`.
 * Attacker model: the signature travels intact but the payload is modified
 * in transit — the attacker cannot re-sign (no secret), so the signature
 * must no longer match the delivered bytes.
 */
async function deliver(signedBody, sentBody = signedBody) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: svixHeaders(signedBody, whsec),
    body: sentBody,
  });
  return res.status;
}

async function main() {
  if (!whsec) {
    console.error('❌ No Svix signing secret configured (EMAIL_RESEND_WEBHOOK_SECRET in server/.env).');
    console.error('   Provision it first:  npm run resend:setup');
    process.exit(1);
  }
  if (!/^https?:\/\//.test(webhookUrl)) {
    console.error('❌ No webhook URL. Pass one or set EMAIL_WEBHOOK_URL in server/.env:');
    console.error('   node scripts/resend-webhook-check.js https://<tunnel-host>/api/email/webhook');
    process.exit(1);
  }

  const event = {
    type: 'email.received',
    created_at: new Date().toISOString(),
    data: {
      email_id: `check-${process.pid}-${Date.now()}`,
      from: 'Webhook Check <check@external.test>',
      to: ['support@kneachat.com'],
      subject: 'resend-webhook-check',
      attachments: [],
    },
  };
  const goodBody = JSON.stringify(event);
  // Flip one byte of meaning while keeping a plausible envelope — the
  // signature no longer covers the delivered bytes.
  const tamperedBody = JSON.stringify({ ...event, data: { ...event.data, from: 'Attacker <evil@external.test>' } });

  let failed = 0;
  console.log(`POST ${webhookUrl}`);

  const goodStatus = await deliver(goodBody);
  if (goodStatus === 200) {
    console.log('✅ valid Svix signature accepted          (HTTP 200)');
  } else {
    failed += 1;
    console.log(`❌ valid Svix signature rejected           (HTTP ${goodStatus}, expected 200)`);
  }

  // Signature over the original bytes, tampered bytes on the wire —
  // exactly what a man-in-the-middle modification looks like.
  const badStatus = await deliver(goodBody, tamperedBody);
  if (badStatus === 401) {
    console.log('✅ tampered payload rejected              (HTTP 401)');
  } else {
    failed += 1;
    console.log(`❌ tampered payload not rejected           (HTTP ${badStatus}, expected 401)`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('❌ Check failed:', error.message || error);
  process.exit(1);
});
