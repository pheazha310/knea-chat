#!/usr/bin/env node
/**
 * Provision the Resend resources KneaChat needs for the email omni-channel:
 *
 *   1. email.received webhook  → EMAIL_RESEND_WEBHOOK_SECRET (Svix whsec_…)
 *   2. API key (first run only) → EMAIL_RESEND_API_KEY (fetches inbound bodies)
 *
 * Both values are written straight into server/.env. The webhook signing
 * secret is ONLY returned on create/get/rotate — it is never shown in the
 * dashboard again — which is why this script stores it for you instead of
 * asking you to copy it by hand.
 *
 * A management key is required to provision anything (the dashboard key you
 * created manually works). The generated delivery key is written into .env
 * but NOT kept in the script's memory — it cannot be listed again later.
 *
 * Env / CLI:
 *   RESEND_MANAGEMENT_API_KEY  dashboard API key with webhook+api-key scope
 *                              (or pass as the first CLI argument)
 *   EMAIL_WEBHOOK_URL          public HTTPS webhook URL
 *                              (or pass as the second CLI argument)
 *   EMAIL_RESEND_API_KEY       reuse an existing delivery key — skips step 2
 *
 * Usage:
 *   npm run resend:setup
 *   npm run resend:setup -- re_xxx https://<tunnel-host>/api/email/webhook
 *
 * Requires `npm install resend` (the delivery SDK this project uses).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '.env');
const ENV_PATH = '/api/email/webhook';

let managementKey = process.argv[2] || process.env.RESEND_MANAGEMENT_API_KEY || '';
const argUrl = process.argv[3];
const webhookUrl = argUrl || process.env.EMAIL_WEBHOOK_URL || '';

/** Upsert KEY=VALUE in server/.env, preserving everything else. */
function upsertEnv(key, value) {
  const line = `${key}=${value}`;
  const content = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const lines = content.split('\n');
  const index = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (index >= 0) {
    if (lines[index] === line) return false;
    lines[index] = line;
  } else {
    lines.push(line);
  }
  fs.writeFileSync(ENV_FILE, lines.join('\n').replace(/\n{3,}$/g, '\n\n').trimEnd() + '\n');
  return true;
}

async function main() {
  if (!managementKey) {
    console.error('❌ No management API key. Create one in the Resend dashboard (resend.com/api-keys)');
    console.error('   then run:  npm run resend:setup -- re_xxx https://<tunnel-host>/api/email/webhook');
    console.error('   (or set RESEND_MANAGEMENT_API_KEY + EMAIL_WEBHOOK_URL in server/.env)');
    process.exit(1);
  }
  if (!webhookUrl) {
    console.error('❌ No webhook URL given.');
    console.error('   Usage: npm run resend:setup -- re_xxx https://<tunnel-host>/api/email/webhook');
    console.error('   Start a tunnel first:  npm run telegram:tunnel   # or npx ngrok http 8080');
    process.exit(1);
  }
  if (!/^https:\/\//.test(webhookUrl)) {
    console.error('❌ Resend webhooks require an HTTPS URL.');
    process.exit(1);
  }

  // Lazily require — the package is also the runtime dependency of the
  // adapter, so it must exist; a clear error beats a stack trace.
  let Resend;
  try {
    ({ Resend } = require('resend'));
  } catch {
    console.error('❌ The `resend` package is not installed — run: npm install resend');
    process.exit(1);
  }

  const admin = new Resend(managementKey);

  // ------------------------------------------------------------------
  // 1. Webhook — idempotent: reuse this project's existing email.received
  //    webhook (updating its endpoint when the URL changed — e.g. a new
  //    tunnel hostname) instead of creating duplicates, and store its
  //    signing secret in .env.
  // ------------------------------------------------------------------
  let whsec = process.env.EMAIL_RESEND_WEBHOOK_SECRET || '';
  {
    const { data: list, error: listError } = await admin.webhooks.list();
    if (listError) {
      console.error(`❌ Listing webhooks failed: ${listError.message || listError}`);
      process.exit(1);
    }
    const received = (list?.data || []).filter((w) => (w.events || []).includes('email.received'));
    const existing = received.find((w) => w.endpoint === webhookUrl) || received[0];
    if (existing) {
      if (existing.endpoint !== webhookUrl) {
        const { error: updateError } = await admin.webhooks.update(existing.id, {
          endpoint: webhookUrl,
          events: ['email.received'],
        });
        if (updateError) {
          console.error(`❌ Updating webhook endpoint failed: ${updateError.message || updateError}`);
          process.exit(1);
        }
        console.log(`✅ Webhook ${existing.id} endpoint updated → ${webhookUrl}`);
      } else {
        console.log(`✅ Webhook already points at ${webhookUrl}`);
      }
      const { data: full, error: getError } = await admin.webhooks.get(existing.id);
      if (getError || !full) {
        console.error(`❌ Reading webhook ${existing.id} failed: ${(getError && getError.message) || getError}`);
        process.exit(1);
      }
      whsec = full.signing_secret;
      console.log(`   Webhook ${full.id} (status: ${full.status})`);
    } else {
      const { data: created, error: createError } = await admin.webhooks.create({
        endpoint: webhookUrl,
        events: ['email.received'],
      });
      if (createError || !created) {
        console.error(`❌ Creating webhook failed: ${(createError && createError.message) || createError}`);
        console.error('   Check that the management key has webhook scope.');
        process.exit(1);
      }
      whsec = created.signing_secret;
      console.log(`✅ Webhook created (${created.id}) → ${webhookUrl}`);
    }
    if (whsec && upsertEnv('EMAIL_RESEND_WEBHOOK_SECRET', whsec)) {
      console.log('   EMAIL_RESEND_WEBHOOK_SECRET written to server/.env');
    } else if (whsec) {
      console.log('   EMAIL_RESEND_WEBHOOK_SECRET unchanged in server/.env');
    }
  }

  // ------------------------------------------------------------------
  // 1b. Persist the endpoint URL itself — the backend reads it for the
  //     startup reachability check and webhook-info, so it must never go
  //     stale when the tunnel hostname changes.
  // ------------------------------------------------------------------
  if (upsertEnv('EMAIL_WEBHOOK_URL', webhookUrl)) {
    console.log('   EMAIL_WEBHOOK_URL written to server/.env');
  } else {
    console.log('   EMAIL_WEBHOOK_URL unchanged in server/.env');
  }

  // ------------------------------------------------------------------
  // 2. API key — only created when .env has none: Resend never shows a
  //    key's token again, so an existing one is kept, not rotated.
  // ------------------------------------------------------------------
  if (process.env.EMAIL_RESEND_API_KEY) {
    console.log(`ℹ️  EMAIL_RESEND_API_KEY already set (${maskKey(process.env.EMAIL_RESEND_API_KEY)}) — keeping it`);
  } else {
    const { data: key, error: keyError } = await admin.apiKeys.create({
      name: `kneachat-${new Date().toISOString().slice(0, 10)}`,
    });
    if (keyError || !key) {
      console.error(`❌ Creating API key failed: ${(keyError && keyError.message) || keyError}`);
      console.error('   Create one in the dashboard and set EMAIL_RESEND_API_KEY manually.');
      process.exit(1);
    }
    upsertEnv('EMAIL_RESEND_API_KEY', key.token);
    console.log(`✅ API key created (${key.id}) → EMAIL_RESEND_API_KEY written to server/.env`);
  }

  // ------------------------------------------------------------------
  // 3. Ping the webhook host so a dead tunnel is caught now, not when the
  //    first customer email silently never arrives.
  // ------------------------------------------------------------------
  const base = webhookUrl.replace(new RegExp(`${ENV_PATH}$`), '');
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(12000) });
    if (res.ok) {
      console.log('✅ Webhook host reachable — deliveries should arrive.');
    } else {
      console.log(`⚠️  Host answered HTTP ${res.status} — check the tunnel/backend before testing.`);
    }
  } catch (err) {
    console.log(`⚠️  Could not reach the host (${err.message || err}) — is the tunnel running?`);
    console.log('   Restart the tunnel, then re-run this script (the URL changes).');
  }

  console.log('\nDone. Restart the backend so the new env vars are picked up, then');
  console.log('send a test email to your Resend receiving address:');
  console.log('  resend test        # any address at <your-id>.resend.app');
}

function maskKey(key) {
  return key.length > 10 ? `${key.slice(0, 7)}…${key.slice(-4)}` : key;
}

main().catch((err) => {
  console.error('❌ Resend setup failed:', err.message || err);
  process.exit(1);
});
