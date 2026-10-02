#!/usr/bin/env node
/**
 * Email DNS hardening for a Google Workspace domain: SPF + Google DKIM.
 *
 * Run AFTER the zone migration to Cloudflare completes (see
 * docs/CLOUDFLARE_ZONE_MIGRATION.md). The script hard-gates on the zone's
 * nameservers: it refuses to touch anything while NS is still at GoDaddy
 * (records created there would land in the wrong zone).
 *
 * What it does:
 *   SPF  — fully automatic: creates the root TXT record
 *          `v=spf1 include:_spf.google.com ~all` via the Cloudflare API.
 *          An existing SPF is reported and left untouched (never stacked).
 *   DKIM — creates `google._domainkey.<domain>` TXT from the key Google
 *          Admin shows (Apps → Google Workspace → Gmail → Authenticate email
 *          → generate new record, selector `google`). Google Admin cannot be
 *          automated without an OAuth app, so the value is passed in.
 *
 * Requires: CLOUDFLARE_API_TOKEN in server/.env (or env) with
 * Zone:Read + DNS:Edit for the zone. Create it at
 * dash.cloudflare.com/profile/api-tokens.
 *
 * Usage:
 *   npm run email:dns-harden -- <domain> [--dkim "v=DKIM1; k=rsa; p=…"]
 *   npm run email:dns-harden -- sopheaphal.site
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { execSync } = require('child_process');

const args = process.argv.slice(2);
const domain = (args.find((a) => !a.startsWith('--')) || 'sopheaphal.site').toLowerCase();
const dkimIdx = args.indexOf('--dkim');
const dkimRecord = dkimIdx >= 0 ? args[dkimIdx + 1] : process.env.GOOGLE_DKIM_RECORD || '';

const SPF_RECORD = 'v=spf1 include:_spf.google.com ~all';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';

function dig(name, type) {
  try {
    return execSync(`dig +short ${type} ${name} @1.1.1.1`, { encoding: 'utf8', timeout: 15_000 }).trim();
  } catch {
    return '';
  }
}

async function cfApi(method, path, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => null) };
}

/** Create the TXT record, or update when one already exists with other content. */
async function upsertTxt(zoneId, name, content, label) {
  const list = await cfApi('GET', `/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(name)}&per_page=50`);
  if (!list.ok) {
    console.error(`❌ ${label}: listing records failed (HTTP ${list.status}): ${list.json?.errors?.[0]?.message || ''}`);
    return false;
  }
  const records = list.json?.result || [];
  const existing = records.find((r) => (r.content || '').replace(/^"|"$/g, '') === content);
  if (existing) {
    console.log(`✅ ${label}: already present (${name})`);
    return true;
  }
  if (records.length > 0) {
    console.error(`⚠️  ${label}: a different ${name} TXT exists — NOT overwriting:`);
    for (const r of records) console.error(`   "${(r.content || '').slice(0, 100)}"`);
    return false;
  }
  const created = await cfApi('POST', `/zones/${zoneId}/dns_records`, { type: 'TXT', name, content, ttl: 3600 });
  if (!created.ok) {
    console.error(`❌ ${label}: create failed (HTTP ${created.status}): ${created.json?.errors?.[0]?.message || ''}`);
    return false;
  }
  console.log(`✅ ${label}: created ${name}`);
  return true;
}

async function main() {
  console.log(`\nEmail DNS hardening — ${domain}\n`);

  // --- Gate 1: zone must be on Cloudflare nameservers ------------------------
  const ns = dig(domain, 'NS');
  if (!/\.ns\.cloudflare\.com\.?$/im.test(ns)) {
    console.error('❌ Gate: the zone is not on Cloudflare nameservers yet:');
    console.error(`   NS → ${ns.split('\n').join(' ') || '(none)'}`);
    console.error('   Finish docs/CLOUDFLARE_ZONE_MIGRATION.md steps 1–2 first, then re-run.');
    process.exit(1);
  }
  console.log(`✅ NS on Cloudflare: ${ns.split('\n').join(', ')}`);

  // --- Gate 2: API token ------------------------------------------------------
  if (!TOKEN) {
    console.error('❌ CLOUDFLARE_API_TOKEN is not set.');
    console.error('   Create one at dash.cloudflare.com/profile/api-tokens (Zone:Read + DNS:Edit),');
    console.error('   then add CLOUDFLARE_API_TOKEN=… to server/.env and re-run.');
    process.exit(1);
  }
  const zone = await cfApi('GET', `/zones?name=${encodeURIComponent(domain)}`);
  const zoneId = zone.json?.result?.[0]?.id;
  if (!zone.ok || !zoneId) {
    console.error(`❌ Zone "${domain}" not found in this Cloudflare account (HTTP ${zone.status}).`);
    process.exit(1);
  }
  console.log(`✅ Zone found (${zoneId.slice(0, 8)}…)`);

  let ok = true;

  // --- SPF --------------------------------------------------------------------
  console.log('\n── SPF ────────────────────────────────────────────────');
  const currentTxt = dig(domain, 'TXT');
  if (/^"?v=spf1/im.test(currentTxt)) {
    console.log(`⚠️  SPF already exists — leaving untouched: ${currentTxt.split('\n')[0].slice(0, 90)}`);
  } else {
    ok = (await upsertTxt(zoneId, domain, SPF_RECORD, 'SPF')) && ok;
  }

  // --- DKIM ---------------------------------------------------------------------
  console.log('\n── Google DKIM ────────────────────────────────────────');
  if (!dkimRecord) {
    console.log('ℹ️  Skipped — no DKIM key provided. To enable:');
    console.log('   1. Google Admin → Apps → Google Workspace → Gmail → Authenticate email');
    console.log('   2. Generate new record (selector: google), copy the TXT value');
    console.log(`   3. npm run email:dns-harden -- ${domain} --dkim "v=DKIM1; k=rsa; p=…"`);
  } else if (!dkimRecord.includes('v=DKIM1')) {
    console.error('❌ The --dkim value does not look like a DKIM record (expected "v=DKIM1; …").');
    ok = false;
  } else {
    ok = (await upsertTxt(zoneId, `google._domainkey.${domain}`, dkimRecord, 'DKIM')) && ok;
  }

  // --- Verify --------------------------------------------------------------------
  console.log('\n── Verify (dig) ───────────────────────────────────────');
  await new Promise((r) => setTimeout(r, 3000));
  const spf = dig(domain, 'TXT').split('\n').find((l) => l.includes('v=spf1'));
  console.log(`   SPF  → ${spf || '(not visible yet)'}`);
  const dk = dig(`google._domainkey.${domain}`, 'TXT');
  if (dkimRecord) console.log(`   DKIM → ${dk ? 'visible' : '(not visible yet — TTL/propagation)'}`);

  console.log(ok ? '\n✅ Done.' : '\n⚠️  Completed with warnings — review above.');
  process.exit(ok ? 0 : 2);
}

main().catch((err) => {
  console.error('❌ email-dns-harden failed:', err.message || err);
  process.exit(1);
});
