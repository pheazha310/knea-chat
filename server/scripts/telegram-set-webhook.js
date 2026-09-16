#!/usr/bin/env node
/**
 * Register the Telegram webhook.
 *
 * URL resolution order:
 *   1. First CLI argument:  npm run telegram:webhook -- https://x.trycloudflare.com/api/telegram/webhook
 *   2. TELEGRAM_WEBHOOK_URL from server/.env
 *
 * The bot token and secret come from the environment (TELEGRAM_BOT_TOKEN /
 * TELEGRAM_WEBHOOK_SECRET). After registering, the script pings the host so a
 * dead tunnel is caught immediately instead of silently dropping updates.
 *
 * Related: `npm run telegram:status` (inspect), `npm run telegram:bridge`
 * (webhook-free alternative), `npm run telegram:tunnel` (start a quick tunnel).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const argUrl = process.argv[2];
const webhookUrl = argUrl || process.env.TELEGRAM_WEBHOOK_URL || '';

async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

async function main() {
  if (!TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN is not set (server/.env).');
    process.exit(1);
  }
  if (!webhookUrl) {
    console.error('❌ No webhook URL given.');
    console.error('   Usage: npm run telegram:webhook -- https://<tunnel-host>/api/telegram/webhook');
    console.error('   Or set TELEGRAM_WEBHOOK_URL in server/.env.');
    process.exit(1);
  }
  if (!/^https:\/\//.test(webhookUrl)) {
    console.error('❌ Telegram requires an HTTPS webhook URL.');
    process.exit(1);
  }

  const result = await tg('setWebhook', {
    url: webhookUrl,
    allowed_updates: ['message'],
    ...(SECRET ? { secret_token: SECRET } : {}),
  });
  if (!result.ok) {
    console.error(`❌ setWebhook failed: ${result.description || 'unknown error'}`);
    process.exit(1);
  }
  console.log(`✅ Webhook registered: ${webhookUrl}`);

  // Verify the host actually answers — a registered-but-dead URL is the
  // classic silent failure (updates pile up as pending instead of arriving).
  const base = webhookUrl.replace(/\/api\/telegram\/webhook$/, '');
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(12000) });
    if (res.ok) {
      console.log('✅ Host reachable — deliveries should arrive.');
    } else {
      console.log(`⚠️  Host answered HTTP ${res.status} — check the tunnel/backend before testing.`);
    }
  } catch (err) {
    console.log(`⚠️  Could not reach the host (${err.message || err}) — is the tunnel running?`);
    console.log('   npm run telegram:tunnel   # restart, then re-run this script (URL changes)');
  }

  if (!SECRET) {
    console.log('⚠️  TELEGRAM_WEBHOOK_SECRET is empty — the webhook endpoint will reject deliveries.');
  }
}

main().catch((err) => {
  console.error('❌ Webhook setup failed:', err.message || err);
  process.exit(1);
});
