#!/usr/bin/env node
/**
 * Telegram long-polling bridge (temporary alternative to the webhook).
 *
 * When no public HTTPS tunnel is available (dead quick-tunnel URL, firewall,
 * etc.), Telegram cannot deliver webhooks. This bridge pulls updates with
 * `getUpdates` long polling and replays each one into the LOCAL webhook
 * endpoint (`POST /api/telegram/webhook`) so the exact production processing
 * path — secret check, OmniChannelService.parseInbound, persistence,
 * WebSocket fan-out — runs unchanged.
 *
 * Start-up calls `deleteWebhook` (Telegram forbids getUpdates while a webhook
 * is active). To go back to webhook mode afterwards, re-run
 * `POST /api/telegram/setup-webhook` or `setWebhook` with a live public URL.
 *
 * The update offset is persisted to a small state file so a restart neither
 * replays nor skips updates.
 *
 * Usage: node scripts/telegram-poll-bridge.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const LOCAL_WEBHOOK = `http://localhost:${process.env.PORT || 8080}/api/telegram/webhook`;
const OFFSET_FILE = path.join(__dirname, '..', 'tmp', 'telegram-bridge-offset.json');
const LONG_POLL_SECONDS = 25;
const RETRY_DELAY_MS = 3000;

if (!TOKEN) {
  console.error('[bridge] TELEGRAM_BOT_TOKEN is not set — cannot poll Telegram.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(OFFSET_FILE), { recursive: true });

function loadOffset() {
  try {
    return JSON.parse(fs.readFileSync(OFFSET_FILE, 'utf8')).offset || null;
  } catch {
    return null;
  }
}

function saveOffset(offset) {
  try {
    fs.writeFileSync(OFFSET_FILE, JSON.stringify({ offset, updated_at: new Date().toISOString() }));
  } catch (err) {
    console.warn('[bridge] Could not persist offset:', err.message);
  }
}

/** Best-effort update summary for the log line. */
function describe(update) {
  const msg = update.message || update.edited_message;
  if (!msg) return `update kind ${Object.keys(update).find((k) => k !== 'update_id') || 'unknown'}`;
  const text = msg.text || msg.caption || (msg.voice ? '[voice]' : msg.photo ? '[photo]' : '[media]');
  const from = msg.from ? msg.from.first_name || msg.from.username || msg.from.id : '?';
  return `${from}: ${String(text).slice(0, 40)}`;
}

async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout((LONG_POLL_SECONDS + 10) * 1000),
  });
  const json = await res.json();
  if (!json.ok) {
    throw new Error(`${method} failed: ${json.error_code || res.status} ${json.description || ''}`);
  }
  return json.result;
}

/** Replay one update into the local webhook endpoint. Returns true on 2xx. */
async function feedLocalWebhook(update) {
  const res = await fetch(LOCAL_WEBHOOK, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': SECRET,
    },
    body: JSON.stringify(update),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    console.error(`[bridge] Local webhook returned HTTP ${res.status} for update ${update.update_id}`);
  }
  return res.ok;
}

async function main() {
  // Switching to polling requires the webhook to be removed.
  try {
    await tg('deleteWebhook', { drop_pending_updates: false });
    console.log('[bridge] Webhook removed — polling mode active.');
  } catch (err) {
    console.warn('[bridge] deleteWebhook:', err.message);
  }

  let offset = loadOffset();
  if (offset) console.log(`[bridge] Resuming from offset ${offset}`);
  console.log(`[bridge] Feeding updates into ${LOCAL_WEBHOOK}`);

  while (true) {
    let updates;
    try {
      updates = await tg('getUpdates', { offset, timeout: LONG_POLL_SECONDS });
    } catch (err) {
      console.error('[bridge] getUpdates error:', err.message);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      continue;
    }

    for (const update of updates) {
      const ok = await feedLocalWebhook(update);
      if (ok) {
        // Only advance after the app accepted the update, so failures retry.
        offset = update.update_id + 1;
        saveOffset(offset);
        console.log(`[bridge] ✓ update ${update.update_id} — ${describe(update)}`);
      } else {
        // Stop advancing; the next getUpdates call redelivers this update.
        break;
      }
    }
  }
}

main().catch((err) => {
  console.error('[bridge] Fatal:', err.message);
  process.exit(1);
});
