# Move `sopheaphal.site` to Cloudflare (for the named email tunnel)

Goal: host `email.sopheaphal.site` in a Cloudflare zone so the email webhook
URL is stable (named tunnel, survives reboots) via
`npm run email:named-tunnel -- email.sopheaphal.site kneachat-email`.

**Critical constraint:** Google Workspace mail is LIVE on this domain —
breaking its MX records breaks real email.

## Current state (verified 2026-09-25)

| Record | Value | Status |
|---|---|---|
| NS | `ns35/36.domaincontrol.com` (GoDaddy) | to be replaced by Cloudflare NS |
| MX (5) | `1 aspmx.l.google.com`, `5 alt1/alt2`, `10 alt3/alt4` | **must preserve — live mail** |
| TXT `_dmarc` | `v=DMARC1; p=quarantine; …` | must preserve |
| A `@` | `100.26.196.58` | site already dead (HTTP 000) — safe to drop |
| TXT `@` (SPF) | none | optional add: `v=spf1 include:_spf.google.com ~all` |
| DKIM | no `google._domainkey` selector found | optional: enable DKIM in Google Admin |
| `api` subdomain | does not resolve | note: the Resend webhook `a1f281bd…` targets `https://api.sopheaphal.site/api/webhooks/resend` and will fail until that host exists |

## Steps

### 1. Add the zone in Cloudflare (dashboard, ~5 min)

Cloudflare → **Add a site** → `sopheaphal.site` → Free plan. Cloudflare
auto-scans and imports the existing records. **Verify the imported records
match the table above, especially the 5 MX rows**, before touching the
registrar. Add nothing yet.

### 2. Repoint nameservers at GoDaddy (dashboard, propagation 10 min–24 h)

GoDaddy → My Products → `sopheaphal.site` → DNS → Nameservers → **Custom** →
replace the two `domaincontrol.com` entries with the pair Cloudflare shows
after step 1.

Mail keeps working during propagation: the Google MX records exist in both
zones; resolvers switch over seamlessly.

### 3. Verify the switch (terminal)

```bash
dig +short NS sopheaphal.site @1.1.1.1        # → *.ns.cloudflare.com
dig +short MX sopheaphal.site @1.1.1.1        # → still the 5 aspmx/alt rows
dig +short TXT _dmarc.sopheaphal.site @1.1.1.1 # → v=DMARC1; p=quarantine…
```

Send yourself a test message on the Workspace address and confirm it arrives.

### 4. Run the named-tunnel switch

```bash
cloudflared tunnel login   # if not done yet — browser, pick sopheaphal.site
npm run email:named-tunnel -- email.sopheaphal.site kneachat-email
```

The script handles: tunnel create → `~/.cloudflared/config.yml` → DNS route →
`EMAIL_WEBHOOK_URL` in `server/.env` → Resend webhook PATCH → LaunchAgent
(`KeepAlive`, named tunnel) → backend restart → public probe.

### 5. Confirm

```bash
curl -si https://email.sopheaphal.site/api/email/webhook -X POST -d '{}' | head -1
# → HTTP/2 401  (reachable + signature-enforced = healthy)
```

`EMAIL_WEBHOOK_URL` is now permanent — reboots and tunnel restarts no longer
change the hostname, and the Resend webhook never needs updating again.
