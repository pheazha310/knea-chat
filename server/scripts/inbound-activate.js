#!/usr/bin/env node
/**
 * Wait for Resend to verify the inbound domain, then finish the inbound wiring
 * automatically:
 *
 *   1. Poll GET /domains/:id until status === 'verified' (all records found)
 *   2. Upsert EMAIL_INBOUND_DOMAIN=<domain> in server/.env
 *   3. Touch dist/src/server.js → nodemon reloads with the new env
 *   4. Probe the local backend health endpoint
 *
 * Resend only re-checks its records periodically, so expect a few minutes
 * between saving the DNS records and this script flipping to verified.
 *
 * Usage (leave it running in a terminal):
 *   npm run email:inbound-activate
 *   TIMEOUT_HOURS=6 npm run email:inbound-activate
 *   npm run email:inbound-activate -- --once     # single status line, no wait
 *
 * Env: EMAIL_RESEND_API_KEY in server/.env. Domain id is resolved by name, so
 * the script is reusable for kneachat.com after it is registered.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ENV_FILE = path.join(__dirname, '..', '.env');
const API = 'https://api.resend.com';
const DOMAIN = process.env.EMAIL_INBOUND_DOMAIN_PENDING || process.env.EMAIL_INBOUND_DOMAIN || 'sopheaphal.site';
const KEY = process.env.EMAIL_RESEND_API_KEY || '';
const POLL_SECONDS = parseInt(process.env.POLL_SECONDS || '30', 10);
const DEADLINE = Date.now() + parseFloat(process.env.TIMEOUT_HOURS || '6') * 3600 * 1000;
const ONCE = process.argv.includes('--once');

function log(...a) { console.log(new Date().toISOString(), ...a); }

function upsertEnv(key, value) {
  const line = `${key}=${value}`;
  const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0 && lines[i] === line) return false;
  if (i >= 0) lines[i] = line; else lines.push(line);
  fs.writeFileSync(ENV_FILE, lines.join('\n').replace(/\n{3,}$/g, '\n\n').trimEnd() + '\n');
  return true;
}

async function domainRecord() {
  const list = await (await fetch(`${API}/domains`, { headers: { Authorization: `Bearer ${KEY}` } })).json();
  const found = (list.data || []).find((d) => d.name === DOMAIN);
  if (!found) return null;
  const full = await (await fetch(`${API}/domains/${found.id}`, { headers: { Authorization: `Bearer ${KEY}` } })).json();
  return full;
}

async function main() {
  if (!KEY) { console.error('❌ EMAIL_RESEND_API_KEY missing in server/.env'); process.exit(1); }

  let round = 0;
  while (true) {
    round += 1;
    let d;
    try { d = await domainRecord(); } catch (e) { d = null; }
    if (!d) { log(`❌ domain "${DOMAIN}" not found in the Resend account`); process.exit(1); }

    const recs = (d.records || []).map((r) => `${r.record}:${r.status}`).join(' ');
    log(`poll ${round} → ${d.status} (receiving: ${d.capabilities?.receiving}) ${recs}`);

    if (d.status === 'verified') {
      log(`✅ ${DOMAIN} verified — finishing wiring…`);
      if (upsertEnv('EMAIL_INBOUND_DOMAIN', DOMAIN)) log(`   EMAIL_INBOUND_DOMAIN=${DOMAIN} written to server/.env`);
      else log('   EMAIL_INBOUND_DOMAIN already up to date');
      try {
        execSync(`touch ${path.join(__dirname, '..', 'dist', 'src', 'server.js')}`);
        log('   backend restart triggered (nodemon)');
      } catch { log('   ⚠️ dist/src/server.js not found — build first (npm run build)'); }
      await new Promise((r) => setTimeout(r, 4000));
      try {
        const h = await fetch('http://localhost:8080/api/health', { signal: AbortSignal.timeout(8000) });
        log(`   backend health → HTTP ${h.status}`);
      } catch (e) { log(`   ⚠️ backend health probe failed: ${e.message || e}`); }
      log('\nNext: run the e2e suites (npm run test:e2e:email-suite), then send a real email to any address @' + DOMAIN);
      process.exit(0);
    }

    if (ONCE) process.exit(d.status === 'pending' ? 2 : 1);
    if (Date.now() > DEADLINE) { log(`⏱️  timeout — ${DOMAIN} still ${d.status}`); process.exit(3); }
    await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000));
  }
}

main().catch((e) => { console.error('❌', e.message || e); process.exit(1); });
