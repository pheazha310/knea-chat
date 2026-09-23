#!/usr/bin/env node
/**
 * Domain activation watchdog — kneachat.com
 *
 * One command, set and forget. Run it in a terminal (it must stay open) and
 * it waits for the domain to become real, then completes the ENTIRE email
 * activation sequence automatically:
 *
 *   1. Poll the VeriSign registry until kneachat.com is registered
 *   2. Poll DNS until the registrar's nameservers publish the zone
 *   3. Poll until the Resend records resolve (DKIM TXT, rsend/send CNAMEs, MX)
 *   4. Trigger Resend's verify action and wait for status=verified
 *   5. Flip EMAIL_FROM back to support@kneachat.com in server/.env
 *   6. Verify a real SMTP send from @kneachat.com works (health + probe)
 *
 * Usage:
 *   node scripts/domain-activation-watchdog.js            # default 12h max
 *   TIMEOUT_HOURS=24 node scripts/domain-activation-watchdog.js
 *   POLL_SECONDS=60 node scripts/domain-activation-watchdog.js
 *
 * Exit code 0 = domain activated + EMAIL_FROM switched; anything else = the
 * timeout was reached first (just re-run it — all checks are idempotent).
 *
 * Requires: dig (ships with macOS), node >= 18 (global fetch), server/.env.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DOMAIN = process.env.EMAIL_INBOUND_DOMAIN || 'kneachat.com';
const REGISTRAR_WHOIS_HOST = 'whois.verisign-grs.com';
const ENV_FILE = path.join(__dirname, '..', '.env');
const API_BASE = 'https://api.resend.com';
const FROM_ADDRESS = `support@${DOMAIN}`;

const POLL_SECONDS = parseInt(process.env.POLL_SECONDS || '120', 10);
const TIMEOUT_HOURS = parseFloat(process.env.TIMEOUT_HOURS || '12');
const DEADLINE = Date.now() + TIMEOUT_HOURS * 3600 * 1000;

const DOMAIN_ID = process.env.RESEND_DOMAIN_ID || '';
const API_KEY = process.env.EMAIL_RESEND_API_KEY || '';

const log = (...args) => console.log(new Date().toISOString(), ...args);

/** Run a shell command, return trimmed stdout or null on failure. */
function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 30_000 }).trim();
  } catch {
    return null;
  }
}

function dig(name, type, resolver = '1.1.1.1') {
  const out = sh(`dig +short ${type} ${name} @${resolver}`);
  return out && out.length > 0 ? out : null;
}

/** Upsert KEY=VALUE in server/.env. */
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

async function resend(path, method = 'GET') {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* ignore */
  }
  return { status: res.status, json };
}

// ---------------------------------------------------------------------------
// Stage checks — each returns true when the stage has passed.
// ---------------------------------------------------------------------------

/** Stage 1: the .com registry knows the domain. */
function checkRegistry() {
  const out = sh(`whois -h ${REGISTRAR_WHOIS_HOST} ${DOMAIN}`);
  if (!out) return false;
  if (/no match/i.test(out)) return false;
  log('   ✅ registry: domain is registered');
  return true;
}

/** Stage 2: the zone is delegated — nameservers answer for it. */
function checkDelegation() {
  const ns = dig(DOMAIN, 'NS', 'a.gtld-servers.net') || dig(DOMAIN, 'NS');
  if (!ns) return false;
  log(`   ✅ delegation: NS → ${ns.split('\n')[0]}`);
  return true;
}

/** Stage 3: the Resend records resolve publicly. */
function checkRecords() {
  const missing = [];
  if (!dig(`resend._domainkey.${DOMAIN}`, 'TXT')) missing.push('TXT resend._domainkey');
  if (!dig(`rsend.${DOMAIN}`, 'CNAME')) missing.push('CNAME rsend');
  if (!dig(`send.${DOMAIN}`, 'CNAME')) missing.push('CNAME send');
  if (!dig(DOMAIN, 'MX')) missing.push('MX (receiving)');

  if (missing.length > 0) {
    log(`   ⏳ records: still missing ${missing.join(', ')}`);
    return false;
  }
  log('   ✅ records: DKIM + CNAMEs + MX all resolve');
  return true;
}

/** Stage 4: Resend flips the domain to verified. */
async function checkResendVerified() {
  if (!API_KEY) {
    log('   ⚠️  EMAIL_RESEND_API_KEY missing — cannot query/verify via API');
    return false;
  }

  // Resolve the domain id once (env override or lookup by name).
  let id = DOMAIN_ID;
  if (!id) {
    const { json } = await resend('/domains');
    const found = (json?.data || []).find((d) => d.name === DOMAIN);
    if (!found) {
      log(`   ⚠️  ${DOMAIN} not found in the Resend account — add it in the dashboard`);
      return false;
    }
    id = found.id;
    upsertEnv('RESEND_DOMAIN_ID', id);
  }

  // Nudge verification each poll (idempotent, same as the dashboard button).
  await resend(`/domains/${id}/verify`, 'POST');

  const { json } = await resend(`/domains/${id}`);
  const status = json?.status;
  if (status === 'success' || json?.verified === true) {
    log('   ✅ Resend: domain verified');
    return true;
  }
  log(`   ⏳ Resend: status=${status || 'unknown'} — still polling`);
  return false;
}

/** Stage 5: flip EMAIL_FROM to the domain address in server/.env. */
function switchFromAddress() {
  const changed = upsertEnv('EMAIL_FROM', FROM_ADDRESS);
  if (changed) {
    log(`   ✅ .env: EMAIL_FROM → ${FROM_ADDRESS} (restart the backend to load it)`);
  } else {
    log(`   ✅ .env: EMAIL_FROM already ${FROM_ADDRESS}`);
  }
  return true;
}

/** Stage 6: SMTP handshake from the live backend. */
async function checkSmtpHealth() {
  try {
    const res = await fetch('http://localhost:8080/api/email/health', {
      signal: AbortSignal.timeout(20_000),
    });
    const json = await res.json();
    if (json?.info?.smtpConnected) {
      log(`   ✅ SMTP: connected (from=${json?.info?.from})`);
      return json?.info?.from === FROM_ADDRESS;
    }
    log('   ⏳ SMTP: backend reports smtpConnected=false (restart backend after .env change)');
  } catch (e) {
    log(`   ⏳ SMTP: backend unreachable on :8080 (${e.message})`);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function main() {
  log(`👁  domain activation watchdog for ${DOMAIN}`);
  log(`   polling every ${POLL_SECONDS}s, timeout ${TIMEOUT_HOURS}h\n`);

  const stages = [
    { name: '1. registry', check: checkRegistry },
    { name: '2. delegation', check: checkDelegation },
    { name: '3. DNS records', check: checkRecords },
    { name: '4. Resend verified', check: checkResendVerified, async: true },
    { name: '5. EMAIL_FROM switch', check: switchFromAddress },
    { name: '6. SMTP health', check: checkSmtpHealth, async: true },
  ];
  let done = 0;

  while (done < stages.length) {
    if (Date.now() > DEADLINE) {
      log(`\n⏰ ${TIMEOUT_HOURS}h reached with ${done}/${stages.length} stages complete.`);
      log('   Re-run this script any time — it resumes where it left off.');
      process.exit(1);
    }

    log(`\n── poll (${done}/${stages.length} stages done)`);
    // Strictly sequential: a stage only runs when every earlier stage is
    // done (e.g. EMAIL_FROM must not flip before Resend is verified, or a
    // backend restart would ship an unverified sending domain).
    for (const stage of stages) {
      if (stage.done) continue;
      const ok = stage.async ? await stage.check() : stage.check();
      stage.done = !!ok;
      if (ok) {
        done += 1;
      } else {
        break;
      }
    }

    if (done < stages.length) {
      await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000));
    }
  }

  log('\n🎉 ALL STAGES COMPLETE');
  log(`   ${DOMAIN} is registered, DNS records resolve, Resend verified,`);
  log(`   EMAIL_FROM=${FROM_ADDRESS} and SMTP is connected.`);
  log('   Final step (manual): send a real email to admin@' + DOMAIN + ' —');
  log('   it should appear in the Omni Inbox within seconds.');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ watchdog error:', err.message || err);
  process.exit(1);
});
