#!/usr/bin/env node
/**
 * Telegram omni-channel status at a glance.
 *
 * Shows, in order:
 *   1. Bot token configured + authenticates (getMe)
 *   2. Webhook registration as Telegram sees it (getWebhookInfo)
 *   3. Whether the registered URL is currently reachable (best-effort ping)
 *
 * Usage: npm run telegram:status
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

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

  // 1. Bot identity
  const me = await tg('getMe');
  if (!me.ok) {
    console.error(`❌ Bot token rejected by Telegram: ${me.description || 'unknown error'}`);
    process.exit(1);
  }
  console.log(`✅ Bot: @${me.result.username} (id ${me.result.id})`);

  // 2. Webhook registration
  const hook = await tg('getWebhookInfo');
  const info = hook.ok ? hook.result : null;
  if (!info) {
    console.error('❌ Could not read webhook info from Telegram.');
    process.exit(1);
  }
  if (info.url) {
    console.log(`✅ Webhook registered: ${info.url}`);
    console.log(`   pending updates: ${info.pending_update_count ?? 0}${info.last_error_message ? `\n   ⚠️  last delivery error: ${info.last_error_message}${info.last_error_date ? ` (${new Date(info.last_error_date * 1000).toISOString()})` : ''}` : ''}`);
  } else {
    console.log('❌ No webhook registered — Telegram is NOT delivering updates.');
    console.log('   Fix: npm run telegram:webhook -- <public-url>/api/telegram/webhook');
    console.log('   Or run the polling bridge: npm run telegram:bridge');
  }

  // 3. Reachability of the registered URL (webhook mode only)
  if (info.url) {
    const base = info.url.replace(/\/api\/telegram\/webhook$/, '');
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(12000) });
      if (res.ok) {
        console.log('✅ Tunnel/host reachable — deliveries should arrive.');
      } else {
        console.log(`⚠️  Host answered with HTTP ${res.status} — Telegram may see delivery failures.`);
      }
    } catch (err) {
      console.log(`❌ Host unreachable (${err.message || err}) — restart the tunnel:`);
      console.log('   npm run telegram:tunnel   # then re-register: npm run telegram:webhook');
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error('❌ Status check failed:', err.message || err);
  process.exit(1);
});
