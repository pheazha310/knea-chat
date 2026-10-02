#!/usr/bin/env node
/**
 * Add the Resend receiving DNS records to a CLOUDFLARE zone via API —
 * the durable path out of a broken GoDaddy DNS editor.
 *
 * Safe by design: run it BEFORE the nameserver switch. Records are created in
 * the Cloudflare zone (inactive until NS propagates), so nothing changes for
 * the live zone until GoDaddy's NS is flipped. The script also mirrors the
 * critical apex rows (Google Workspace MX + DMARC) into the Cloudflare zone
 * if missing, so mail keeps flowing after the switch.
 *
 * Requires: CLOUDFLARE_API_TOKEN in server/.env (Zone:Read + DNS:Edit) —
 * dash.cloudflare.com/profile/api-tokens — and the zone already added to the
 * Cloudflare account (dashboard → Add a site → sopheaphal.site).
 *
 * Usage:
 *   npm run email:cloudflare-setup -- <fqdn-of-inbound-domain>
 *   npm run email:cloudflare-setup -- inbound.sopheaphal.site
 *
 * After it passes: flip the nameservers at GoDaddy → NS propagation →
 *   npm run email:named-tunnel -- email.<zone> kneachat-email
 *   npm run email:inbound-activate
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { execSync } = require('child_process');

const DOMAIN = (process.argv[2] || process.env.EMAIL_INBOUND_DOMAIN || 'inbound.sopheaphal.site').replace(/\.$/, '').toLowerCase();
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const RESEND_KEY = process.env.EMAIL_RESEND_API_KEY || '';

const labels = DOMAIN.split('.');
const ZONE = labels.slice(-2).join('.');
const rel = (fqdn) => (fqdn.endsWith(`.${ZONE}`) ? fqdn.slice(0, -(ZONE.length + 1)) : fqdn);

function digAtAuth(name, type) {
  try {
    return execSync(`dig +short @ns35.domaincontrol.com ${type} ${name} +norecurse`, { encoding: 'utf8', timeout: 15_000 }).trim();
  } catch { return ''; }
}

async function cf(method, path, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => null);
  return { ok: !!json?.success, status: res.status, result: json?.result, errors: json?.errors || [] };
}

async function main() {
  console.log(`\nCloudflare DNS setup — inbound domain ${DOMAIN} (zone ${ZONE})\n`);

  if (!TOKEN) {
    console.error('❌ CLOUDFLARE_API_TOKEN missing in server/.env');
    console.error('   dash.cloudflare.com/profile/api-tokens → Create Token →');
    console.error('   "Edit zone DNS" template → zone: sopheaphal.site → paste into .env.');
    process.exit(1);
  }

  // --- 1. Zone must exist in the account --------------------------------------
  const zone = await cf('GET', `/zones?name=${ZONE}`);
  const z = zone.result?.[0];
  if (!z) {
    console.error(`❌ Zone "${ZONE}" is not in this Cloudflare account yet.`);
    console.error('   Dashboard → Add a site → ' + ZONE + ' (Free plan) → then re-run.');
    process.exit(1);
  }
  console.log(`✅ Zone ${ZONE} (${z.status}) — id ${z.id.slice(0, 8)}…`);

  // --- 2. Mirror critical apex records from the live GoDaddy zone -------------
  console.log('\n── Apex mirror (mail safety — Google Workspace MX + DMARC) ──');
  const apexMx = digAtAuth(ZONE, 'MX').split('\n').filter(Boolean).map((line) => {
    const [prio, host] = line.trim().split(/\s+/);
    return { type: 'MX', name: '@', content: host.replace(/\.$/, ''), priority: parseInt(prio, 10) };
  });
  const dmarc = digAtAuth(`_dmarc.${ZONE}`, 'TXT').split('\n').filter(Boolean)
    .map((v) => ({ type: 'TXT', name: `_dmarc.${ZONE}`, content: v.replace(/^"|"$/g, '') }));
  const mirror = [...apexMx, ...dmarc];
  if (mirror.length === 0) console.log('   ⚠️  nothing readable from GoDaddy — add MX/DMARC manually before the NS switch');
  for (const rec of mirror) {
    const cfName = rec.name === '@' ? ZONE : `${rec.name}.${ZONE}`;
    const existing = await cf('GET', `/zones/${z.id}/dns_records?type=${rec.type}&name=${encodeURIComponent(cfName)}&per_page=50`);
    const have = (existing.result || []).some((r) => r.content === rec.content || (rec.type === 'MX' && r.content === rec.content && r.priority === rec.priority));
    if (have) { console.log(`   ✅ ${rec.type} ${cfName} present`); continue; }
    const body = { type: rec.type, name: rec.name, content: rec.content, ttl: 1, ...(rec.priority != null ? { priority: rec.priority } : {}) };
    const made = await cf('POST', `/zones/${z.id}/dns_records`, body);
    console.log(`   ${made.ok ? '✅ mirrored' : `❌ failed (${made.errors?.[0]?.message})`}: ${rec.type} ${cfName} → ${String(rec.content).slice(0, 50)}`);
  }

  // --- 3. Resend records, fetched live ------------------------------------------
  if (!RESEND_KEY) { console.error('\n❌ EMAIL_RESEND_API_KEY missing in server/.env'); process.exit(1); }
  console.log(`\n── Resend records for ${DOMAIN} ────────────────────────────`);
  const list = await (await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${RESEND_KEY}` } })).json();
  const rd = (list.data || []).find((d) => d.name === DOMAIN);
  if (!rd) { console.error(`❌ "${DOMAIN}" not found in the Resend account`); process.exit(1); }
  const full = await (await fetch(`https://api.resend.com/domains/${rd.id}`, { headers: { Authorization: `Bearer ${RESEND_KEY}` } })).json();

  let ok = true;
  for (const r of full.records || []) {
    const cfName = rel(`${r.name}.${ZONE}`);
    const want = { type: r.type, name: cfName, content: r.value, ttl: 1, ...(r.priority != null ? { priority: r.priority } : {}) };
    const existing = await cf('GET', `/zones/${z.id}/dns_records?type=${want.type}&name=${encodeURIComponent(`${cfName === '@' ? ZONE : cfName + '.' + ZONE}`)}&per_page=50`);
    if ((existing.result || []).some((e) => e.content === want.content)) {
      console.log(`   ✅ ${want.type} ${cfName} already present`);
      continue;
    }
    const made = await cf('POST', `/zones/${z.id}/dns_records`, want);
    if (made.ok) console.log(`   ✅ created ${want.type} ${cfName}`);
    else { console.log(`   ❌ ${want.type} ${cfName}: ${made.errors?.[0]?.message}`); ok = false; }
  }

  // --- 4. NS instructions ----------------------------------------------------------
  console.log('\n── Nameserver switch ──────────────────────────────────────');
  console.log(`   GoDaddy → DNS → Nameservers → Custom → replace both with:`);
  for (const ns of z.name_servers || []) console.log(`     ${ns}`);
  console.log('   Propagation check (re-run later): dig +short NS ' + ZONE + ' @1.1.1.1');
  console.log('   Then: npm run email:named-tunnel -- email.' + ZONE + ' kneachat-email');
  console.log('         npm run email:inbound-activate');

  process.exit(ok ? 0 : 2);
}

main().catch((e) => { console.error('❌', e.message || e); process.exit(1); });
