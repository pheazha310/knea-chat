#!/usr/bin/env node
/**
 * Add the Resend receiving DNS records to a GoDaddy-managed zone via API —
 * the no-dashboard fix for a DNS editor that keeps failing silently.
 *
 * What it does:
 *   1. Reads the zone from the GoDaddy API (settle "what does the list show?")
 *   2. Fetches the required records LIVE from the Resend domain record
 *   3. Upserts each one (PUT replaces only that exact type+name row)
 *   4. Verifies every record against GoDaddy's authoritative nameservers
 *
 * Records at the apex ("@") — the Google Workspace MX rows — are never
 * touched: every record is scoped to its own name (inbound, send.inbound, …).
 *
 * Setup (one-time): developer.godaddy.com → API Keys → Create (production)
 *   → add both lines to server/.env:
 *       GODADDY_API_KEY=…
 *       GODADDY_API_SECRET=…
 *
 * Usage:
 *   npm run email:godaddy-setup            # zone derived from EMAIL_INBOUND_DOMAIN
 *   npm run email:godaddy-setup -- <fqdn>  # e.g. inbound.sopheaphal.site
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { execSync } = require('child_process');

const DOMAIN = (process.argv[2] || process.env.EMAIL_INBOUND_DOMAIN || 'inbound.sopheaphal.site').replace(/\.$/, '').toLowerCase();
const KEY = process.env.GODADDY_API_KEY || '';
const SECRET = process.env.GODADDY_API_SECRET || '';
const RESEND_KEY = process.env.EMAIL_RESEND_API_KEY || '';

// Zone = last two labels (works for .site/.com/…). Record name = FQDN minus zone.
const labels = DOMAIN.split('.');
const ZONE = labels.slice(-2).join('.');
const rel = (fqdn) => (fqdn.endsWith(`.${ZONE}`) ? fqdn.slice(0, -(ZONE.length + 1)) : fqdn);
const GO = `https://api.godaddy.com/v1/domains/${ZONE}`;

function digAtAuth(name, type) {
  try {
    return execSync(`dig +short @ns35.domaincontrol.com ${type} ${name} +norecurse`, { encoding: 'utf8', timeout: 15000 }).trim();
  } catch { return ''; }
}

async function gd(method, path, body) {
  const res = await fetch(`${GO}${path}`, {
    method,
    headers: { Authorization: `sso-key ${KEY}:${SECRET}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* PUT 200-empty */ }
  return { ok: res.ok, status: res.status, json };
}

async function main() {
  if (!KEY || !SECRET) {
    console.error('❌ GODADDY_API_KEY / GODADDY_API_SECRET missing in server/.env');
    console.error('   developer.godaddy.com → API Keys → Create New API Key (production),');
    console.error('   add both values to server/.env, then re-run this script.');
    process.exit(1);
  }

  // --- 1. Zone readable? -----------------------------------------------------
  console.log(`\nGoDaddy DNS setup for ${DOMAIN} (zone ${ZONE})\n`);
  const dom = await gd('GET', '');
  if (!dom.ok) {
    console.error(`❌ Cannot read the zone (HTTP ${dom.status}): ${JSON.stringify(dom.json || '')}`);
    console.error('   Check the key/secret and that this key can access this domain.');
    process.exit(1);
  }
  console.log(`✅ Zone reachable — domain status: ${dom.json?.status?.join(', ') || '?'}`);

  // --- 2. Required records, fetched live from Resend ---------------------------
  if (!RESEND_KEY) { console.error('❌ EMAIL_RESEND_API_KEY missing in server/.env'); process.exit(1); }
  const list = await (await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${RESEND_KEY}` } })).json();
  const rd = (list.data || []).find((d) => d.name === DOMAIN);
  if (!rd) { console.error(`❌ "${DOMAIN}" not found in the Resend account`); process.exit(1); }
  const full = await (await fetch(`https://api.resend.com/domains/${rd.id}`, { headers: { Authorization: `Bearer ${RESEND_KEY}` } })).json();

  // Resend record → GoDaddy record shape.
  const wanted = (full.records || []).map((r) => {
    const fqdn = `${r.name}.${ZONE}`;
    const type = r.type;
    const rec = { name: rel(fqdn), type, data: r.value, ttl: 600 };
    if (r.priority != null) rec.priority = r.priority;
    return rec;
  });
  console.log(`   ${wanted.length} records required (from Resend, live)\n`);

  // --- 3. Upsert each -----------------------------------------------------------
  let ok = true;
  for (const rec of wanted) {
    const current = await gd('GET', `/records/${rec.type}/${encodeURIComponent(rec.name)}`);
    const existing = Array.isArray(current.json) ? current.json : [];
    const same = existing.some((e) => e.data === rec.data && (rec.priority == null || e.priority === rec.priority));
    if (same) {
      console.log(`✅ ${rec.type} ${rec.name} already correct`);
      continue;
    }
    const put = await gd('PUT', `/records/${rec.type}/${encodeURIComponent(rec.name)}`, [rec]);
    if (!put.ok) {
      console.error(`❌ ${rec.type} ${rec.name} failed (HTTP ${put.status}): ${JSON.stringify(put.json || '')}`);
      ok = false;
      continue;
    }
    console.log(`✅ ${rec.type} ${rec.name} → ${String(rec.data).slice(0, 60)}${rec.priority != null ? ` (prio ${rec.priority})` : ''}`);
  }

  // --- 4. Authoritative verification ---------------------------------------------
  console.log('\n── Authoritative check (ns35.domaincontrol.com) ──────');
  for (const rec of wanted) {
    const fqdn = `${rec.name === '@' ? '' : rec.name + '.'}${ZONE}`;
    const found = digAtAuth(fqdn, rec.type);
    const mark = found ? '✅' : '⏳';
    console.log(`   ${mark} ${rec.type} ${fqdn}: ${found ? found.split('\n')[0].slice(0, 70) : 'not visible yet (usually < 15 min)'}`);
  }

  console.log(ok
    ? `\n✅ Records submitted. Next: npm run email:inbound-activate  (waits for verified, flips env, restarts)`
    : '\n⚠️  Some records failed — see above. Re-run this script to retry (idempotent).');
  process.exit(ok ? 0 : 2);
}

main().catch((e) => { console.error('❌', e.message || e); process.exit(1); });
