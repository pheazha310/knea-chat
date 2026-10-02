#!/usr/bin/env node
/**
 * Switch the email webhook from a quick tunnel (hostname changes on every
 * restart) to a NAMED Cloudflare tunnel whose hostname survives reboots.
 *
 * Idempotent — safe to re-run. It:
 *   1. Checks prerequisites (cloudflared installed + `cloudflared tunnel login` done)
 *   2. Creates (or reuses) the named tunnel
 *   3. Writes ~/.cloudflared/config.yml (ingress: hostname → localhost:8080)
 *   4. Routes DNS: <hostname> CNAME → the tunnel (`cloudflared tunnel route dns`)
 *   5. Updates EMAIL_WEBHOOK_URL in server/.env
 *   6. Updates the Resend email.received webhook endpoint (delivery key works;
 *      falls back to RESEND_MANAGEMENT_API_KEY when present)
 *   7. Rewrites the com.kneachat.cloudflared LaunchAgent to run the NAMED
 *      tunnel (no more random hostnames) and restarts it
 *   8. Restarts the backend (touch dist/src/server.js → nodemon reload) and
 *      probes the public URL end-to-end
 *
 * Prerequisites (one-time, interactive — cannot be scripted):
 *   cloudflared tunnel login
 *   → opens the browser; pick the Cloudflare zone that will host the hostname
 *     (e.g. a domain you already own and added to Cloudflare).
 *
 * Usage:
 *   node scripts/email-named-tunnel.js <hostname> [tunnel-name]
 *   node scripts/email-named-tunnel.js email.sopheaphal.site kneachat-email
 *
 *   <hostname>    FQDN under a Cloudflare-managed zone in your account
 *   [tunnel-name] defaults to "kneachat-email"
 *
 * The backend keeps running the whole time; the switch takes ~30 seconds.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ENV_FILE = path.join(__dirname, '..', '.env');
const WEBHOOK_PATH = '/api/email/webhook';
const LOCAL_PORT = process.env.PORT || '8080';
const CLOUDFLARED_DIR = path.join(os.homedir(), '.cloudflared');
const CONFIG_YML = path.join(CLOUDFLARED_DIR, 'config.yml');
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.kneachat.cloudflared.plist');
const TUNNEL_LOG = '/tmp/cloudflared-tunnel.log';

const hostname = (process.argv[2] || '').trim();
const tunnelName = (process.argv[3] || 'kneachat-email').trim();

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', timeout: 60_000 }).trim();
}

/** Upsert KEY=VALUE in server/.env, preserving everything else. */
function upsertEnv(key, value) {
  const line = `${key}=${value}`;
  const content = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const lines = content.split('\n');
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) {
    if (lines[i] === line) return false;
    lines[i] = line;
  } else {
    lines.push(line);
  }
  fs.writeFileSync(ENV_FILE, lines.join('\n').replace(/\n{3,}$/g, '\n\n').trimEnd() + '\n');
  return true;
}

async function resendApi(method, apiPath, body) {
  const key = process.env.RESEND_MANAGEMENT_API_KEY || process.env.EMAIL_RESEND_API_KEY || '';
  const res = await fetch(`https://api.resend.com${apiPath}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* 200-empty is fine */ }
  return { status: res.status, ok: res.ok, json };
}

async function main() {
  if (!hostname) {
    console.error('❌ Usage: node scripts/email-named-tunnel.js <hostname> [tunnel-name]');
    console.error('   <hostname> must be an FQDN under a zone managed in your Cloudflare account,');
    console.error('   e.g. email.sopheaphal.site (after moving that zone to Cloudflare).');
    process.exit(1);
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(hostname)) {
    console.error(`❌ "${hostname}" does not look like a valid FQDN.`);
    process.exit(1);
  }
  const webhookUrl = `https://${hostname}${WEBHOOK_PATH}`;

  // --- 1. Prerequisites -----------------------------------------------------
  console.log('\n── 1. Prerequisites ───────────────────────────────────────');
  let cloudflared;
  try { cloudflared = sh('command -v cloudflared'); } catch {
    console.error('❌ cloudflared is not installed — brew install cloudflared');
    process.exit(1);
  }
  console.log(`   cloudflared: ${cloudflared}`);
  const certPath = path.join(CLOUDFLARED_DIR, 'cert.pem');
  if (!fs.existsSync(certPath)) {
    console.error('❌ Not logged in to Cloudflare. Run once (interactive):');
    console.error('     cloudflared tunnel login');
    console.error('   → a browser opens; pick the zone that will host the hostname, then re-run this script.');
    process.exit(1);
  }
  console.log('   origin cert: ok');

  // --- 2. Create or reuse the named tunnel ----------------------------------
  console.log('\n── 2. Named tunnel ────────────────────────────────────────');
  let tunnelId = '';
  try {
    const list = sh(`${cloudflared} tunnel list --output json`);
    const tunnels = JSON.parse(list || '[]');
    const existing = tunnels.find((t) => t.name === tunnelName);
    if (existing) {
      tunnelId = existing.id;
      console.log(`   reusing tunnel "${tunnelName}" (${tunnelId})`);
    }
  } catch { /* list can fail on first run — create below */ }
  if (!tunnelId) {
    try {
      const created = sh(`${cloudflared} tunnel create ${tunnelName}`);
      tunnelId = (created.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) || [])[0] || '';
      console.log(`   created tunnel "${tunnelName}" (${tunnelId || 'id in credentials json'})`);
    } catch (err) {
      console.error(`❌ tunnel create failed: ${err.message}`);
      process.exit(1);
    }
  }
  if (!tunnelId) {
    // Fall back to reading the credentials file name.
    const creds = fs.readdirSync(CLOUDFLARED_DIR).find((f) => /^[0-9a-f-]{36}\.json$/.test(f));
    tunnelId = creds ? creds.replace('.json', '') : '';
  }
  if (!tunnelId) {
    console.error('❌ Could not determine the tunnel id.');
    process.exit(1);
  }

  // --- 3. config.yml ---------------------------------------------------------
  console.log('\n── 3. ~/.cloudflared/config.yml ───────────────────────────');
  const config = [
    `tunnel: ${tunnelId}`,
    `credentials-file: ${path.join(CLOUDFLARED_DIR, `${tunnelId}.json`)}`,
    'protocol: http2',
    'ingress:',
    `  - hostname: ${hostname}`,
    `    service: http://127.0.0.1:${LOCAL_PORT}`,
    '  - service: http_status:404',
    '',
  ].join('\n');
  fs.mkdirSync(CLOUDFLARED_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_YML, config);
  console.log(`   written → ${CONFIG_YML}`);

  // --- 4. DNS route ----------------------------------------------------------
  console.log('\n── 4. DNS route ───────────────────────────────────────────');
  try {
    sh(`${cloudflared} tunnel route dns -f ${tunnelName} ${hostname}`);
    console.log(`   ${hostname} → CNAME ${tunnelId}.cfargotunnel.com (forced)`);
  } catch (err) {
    console.error(`⚠️  DNS route failed: ${(err.stderr || err.message || '').trim().split('\n')[0]}`);
    console.error('   Is the zone for this hostname added to your Cloudflare account?');
    process.exit(1);
  }

  // --- 5. .env ----------------------------------------------------------------
  console.log('\n── 5. server/.env ─────────────────────────────────────────');
  if (upsertEnv('EMAIL_WEBHOOK_URL', webhookUrl)) {
    console.log(`   EMAIL_WEBHOOK_URL=${webhookUrl}`);
  } else {
    console.log('   EMAIL_WEBHOOK_URL already up to date');
  }

  // --- 6. Resend webhook endpoint ---------------------------------------------
  console.log('\n── 6. Resend webhook ──────────────────────────────────────');
  const list = await resendApi('GET', '/webhooks');
  if (!list.ok) {
    console.error(`❌ Listing Resend webhooks failed (HTTP ${list.status}) — check the API key.`);
    process.exit(1);
  }
  const mine = (list.json?.data || []).filter((w) => (w.events || []).includes('email.received'));
  const target = mine.find((w) => w.endpoint === webhookUrl) || mine[0];
  if (!target) {
    console.error('⚠️  No email.received webhook found — run scripts/resend-setup.js first.');
  } else if (target.endpoint === webhookUrl) {
    console.log(`   already points at ${webhookUrl} (${target.id})`);
  } else {
    const upd = await resendApi('PATCH', `/webhooks/${target.id}`, {
      endpoint: webhookUrl,
      events: ['email.received'],
    });
    if (!upd.ok) {
      console.error(`❌ Updating webhook failed (HTTP ${upd.status}): ${upd.json?.message || ''}`);
      console.error('   The delivery key may lack scope — set RESEND_MANAGEMENT_API_KEY in .env.');
      process.exit(1);
    }
    console.log(`   webhook ${target.id} updated → ${webhookUrl}`);
  }

  // --- 7. LaunchAgent → named tunnel -------------------------------------------
  console.log('\n── 7. LaunchAgent ─────────────────────────────────────────');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.kneachat.cloudflared</string>
  <key>ProgramArguments</key>
  <array>
    <string>${cloudflared}</string>
    <string>tunnel</string>
    <string>--config</string>
    <string>${CONFIG_YML}</string>
    <string>run</string>
    <string>${tunnelName}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${TUNNEL_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${TUNNEL_LOG}</string>
</dict>
</plist>
`;
  fs.writeFileSync(PLIST_PATH, plist);
  sh(`launchctl bootout gui/$(id -u)/com.kneachat.cloudflared 2>/dev/null; true`);
  sh(`launchctl bootstrap gui/$(id -u) ${PLIST_PATH}`);
  sh(`launchctl kickstart gui/$(id -u)/com.kneachat.cloudflared 2>/dev/null; true`);
  console.log('   com.kneachat.cloudflared now runs the NAMED tunnel (survives reboots)');

  // --- 8. Restart backend + verify ---------------------------------------------
  console.log('\n── 8. Verify ──────────────────────────────────────────────');
  try { sh(`touch ${path.join(__dirname, '..', 'dist', 'src', 'server.js')}`); } catch { /* not built — skip */ }
  await new Promise((r) => setTimeout(r, 4000));
  const url = `https://${hostname}/api/health`;
  let ok = false;
  for (let i = 1; i <= 6 && !ok; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      ok = res.ok;
      console.log(`   probe ${i}: ${url} → HTTP ${res.status}`);
    } catch (err) {
      console.log(`   probe ${i}: ${url} → ${err.message || err}`);
    }
    if (!ok) await new Promise((r) => setTimeout(r, 5000));
  }
  console.log(ok
    ? `\n✅ Done. Stable webhook URL: ${webhookUrl}\n   It survives reboots and tunnel restarts. No more hostname churn.`
    : `\n⚠️  DNS/route may still be propagating — retry in a minute: curl ${url}`);
  process.exit(ok ? 0 : 2);
}

main().catch((err) => {
  console.error('❌ Named-tunnel switch failed:', err.message || err);
  process.exit(1);
});
