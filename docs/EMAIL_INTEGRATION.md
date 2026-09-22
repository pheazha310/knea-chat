# Email Omni-Channel Integration

KneaChat can act as a support inbox for **Email**: customer emails arrive via a
provider webhook, appear in the Omni Inbox (Messages view) in real time, and
agents reply from KneaChat — replies are delivered over SMTP and threaded with
the customer's original email (RFC 5322 `Message-ID` / `In-Reply-To` /
`References`).

> Sister docs: [`TELEGRAM_INTEGRATION.md`](TELEGRAM_INTEGRATION.md) (Telegram),
> and the omni-channel architecture section in
> [`PROJECT_STRUCTURE_AND_WORKFLOW.md`](PROJECT_STRUCTURE_AND_WORKFLOW.md) §7.

---

## How it works

```
Customer email ─▶ Email provider (Mailgun/SendGrid/SES/Postmark)
                    │  webhook POST (parsed email)
                    ▼
        POST /api/email/webhook          ← signature verified
                    ▼
        EmailAdapter.parseInbound()      ← provider-specific parsing
                    ▼
        OmniChannelService.processInbound('email', payload)
            ├─ findOrCreateContact()      shadow user + external_contacts row
            ├─ findOrCreateConversation() thread resolution (RFC 5322):
            │                             In-Reply-To/References match → join
            │                             that thread's conversation; unknown
            │                             chain → NEW conversation per subject;
            │                             no headers → contact's latest thread
            ├─ createInboundMessage()     messages row + external ledger
            └─ broadcast                  'receive_message' + notification
                    ▼
        Agents see it in the Omni Inbox in real time (WebSocket)

Agent reply (composer in the Messages view):
        POST /api/omni/conversations/:id/messages
                    ▼
        OmniChannelService.sendAgentReply()
            ├─ resolveEmailThreading()    subject + Message-ID chain from the
            │                             customer's last inbound email
            ├─ adapter.sendMessage()      SMTP delivery FIRST
            └─ persist only on success    deliver-then-persist
```

Key properties:

- **Deliver-then-persist** — outbound messages are stored only after the SMTP
  provider accepts them, so the inbox never shows replies the customer never
  got (mirrors the Telegram regression guard).
- **One identity per address** — `external_contacts.email_address` (migration
  029) is unique, so a customer keeps the same contact across threads.
- **One conversation per email thread** — a reply (any `In-Reply-To` /
  `References` Message-ID already in the external ledger) joins that thread's
  conversation; a fresh subject starts a new conversation named after the
  email subject; header-less mail falls back to the contact's most recent
  conversation (migration 030 replaced the per-contact UNIQUE key with a
  plain index). Agent replies inherit the right thread automatically because
  outbound threading headers are derived from the conversation's own ledger
  (`resolveEmailThreading`).
- **Dedupe** — webhook retries are collapsed by the
  `(channel, external_message_id)` unique key plus an in-flight guard.
- **Sanitized** — inbound HTML is stripped of scripts/handlers before storage.

---

## Environment variables (server/.env)

| Variable | Purpose |
|----------|---------|
| `EMAIL_SMTP_HOST` / `EMAIL_SMTP_PORT` | Outbound SMTP server (e.g. `smtp.gmail.com:587`) |
| `EMAIL_SMTP_USER` / `EMAIL_SMTP_PASS` | SMTP credentials (Gmail: email + **app password**) |
| `EMAIL_SMTP_SECURE` | `true` for port 465 (implicit TLS), `false` for 587 (STARTTLS) |
| `EMAIL_FROM` / `EMAIL_FROM_NAME` | From address shown on agent replies |
| `EMAIL_WEBHOOK_SECRET` | Shared HMAC secret for the inbound webhook (32+ bytes, e.g. `openssl rand -hex 32`) |
| `EMAIL_WEBHOOK_URL` | Default target for `POST /api/email/setup-webhook` |
| `EMAIL_WEBHOOK_PUBLIC_KEY` | Optional RSA/ECDSA PEM for providers that sign with a key pair (SendGrid Event Webhook, Postmark) |
| `EMAIL_RESEND_WEBHOOK_SECRET` | Resend (Svix) `whsec_…` webhook signing secret (`npm run resend:setup` provisions it) |
| `EMAIL_RESEND_API_KEY` | Resend API key — fetches body/headers after `email.received` |
| `OMNI_INBOX_AGENT_IDS` | Optional comma-separated user ids allowed in the inbox (empty = every internal user) |

### Thread resolution details

1. The email adapter extracts the `In-Reply-To` + `References` Message-IDs
   from the webhook headers and normalizes them (lower-cased, angle brackets
   stripped — `normalizeMessageId`).
2. The engine looks the ids up in the external ledger
   (`external_messages`: `external_message_id` column or
   `metadata.email.messageId` JSON key), newest inbound first.
3. **Hit** → the email joins that conversation (a closed one is reopened).
4. **Miss with references present** → brand-new thread: a new conversation is
   created and named after the email subject.
5. **No references at all** (first email of a thread or a provider that strips
   headers) → falls back to the contact's most recent conversation.

Lookups scan the channel's inbound ledger rows (a `JSON_EXTRACT` over
metadata), which is fine at support-inbox volumes; add an index on a
generated column if a mailbox ever grows past tens of thousands of
messages.

Reference copy: `server/.env.example`.

## Database

Migration `029_email_omni_channel.sql` adds `external_contacts.email_address`
(uniqued, populated when `channel = 'email'`). Apply it with:

```bash
cd server && npm run db:init   # idempotent; prints "Added email_address ..." when applied
```

No other schema changes — threading metadata lives in
`external_messages.metadata` JSON. Migration 030 (applied by the same
`npm run db:init`) converts `external_conversations`' unique
`(contact_id, channel)` key into a plain index, allowing several
conversations per contact — one per email thread.

---

## Local setup (macOS dev machine)

1. **Configure SMTP** in `server/.env` (see table above). Gmail requires an
   **App Password** (Google Account → Security → 2-Step Verification → App
   passwords); your normal login password will not work and is why
   `GET /api/email/health` may report `smtpConnected: false`.
2. **Expose the webhook publicly** — providers POST over the public internet:

   ```bash
   npx ngrok http 8080          # or: npm run telegram:tunnel (cloudflared)
   ```

   Note the generated `https://…` URL.
3. **Point your provider at it** — in the provider dashboard (or API), set the
   inbound route/webhook to:

   ```
   https://<your-tunnel>/api/email/webhook
   ```

   with the custom headers:
   - `X-Email-Webhook-Secret: <EMAIL_WEBHOOK_SECRET>`
   - `X-Email-Signature: <HMAC-SHA256(body, secret), base64>`

   (Managed providers that sign their own way only need the provider's
   signature scheme — see "Provider notes" below. The shared-secret headers
   are for the generic/simple provider case.)
4. **Restart the backend** (`nodemon` picks up `dist/` rebuilds; env changes
   need a restart) and send a real email to your inbox address. It should
   appear in the Omni Inbox within seconds.

### Health check

```bash
curl http://localhost:8080/api/email/health
# {"success":true,"channel":"email","connected":true,
#  "info":{"configured":true,"provider":"smtp","smtpConnected":true,"from":"…"}}
```

- `configured: true` — SMTP env vars present.
- `smtpConnected: true` — a live SMTP handshake succeeded (outbound works).
  Inbound never needs SMTP.

---

## Provider notes

The parser (`email.service.ts → parseWebhookPayload`) already understands:

| Provider | Payload shape | Signature verification |
|----------|--------------|------------------------|
| **Mailgun** | store-and-notify fields (`recipient`, `subject`, `body-plain`, `message-headers`) | `X-Mailgun-Signature/Timestamp/Token` (HMAC of `timestamp+token`) |
| **SendGrid** | v3 event envelope (`mail.from`, `mail.content[]`) or Inbound Parse multipart (attachment ids + `attachment-info`) | `X-Twilio-Email-Event-Webhook-Signature/Timestamp` (HMAC) or `EMAIL_WEBHOOK_PUBLIC_KEY` (ECDSA) |
| **Amazon SES** | SNS notification envelope (`Type: Notification`, `Message` JSON) | SNS subscription (set `EMAIL_WEBHOOK_SECRET` but rely on SNS delivery) |
| **Postmark** | generic JSON fields | `X-Postmark-Webhook-Signature` (needs `EMAIL_WEBHOOK_PUBLIC_KEY`) |
| **Generic** | `{ recipient, from, subject, text/body, headers, messageId }` | `X-Email-Signature` = HMAC-SHA256(raw body, `EMAIL_WEBHOOK_SECRET`), base64 |

For SendGrid/Postmark key-pair verification, set `EMAIL_WEBHOOK_PUBLIC_KEY` to
the provider's public key in PEM form (use `\n` for newlines in .env).

### Resend (inbound + outbound)

Resend supports both legs and replaces Gmail SMTP entirely:

- **Outbound**: SMTP relay — `smtp.resend.com:465`, user `resend`, password =
  API key (`EMAIL_SMTP_HOST=smtp.resend.com`, `EMAIL_SMTP_PORT=465`,
  `EMAIL_SMTP_SECURE=true`, `EMAIL_SMTP_USER=resend`, `EMAIL_SMTP_PASS=re_…`).
  No app passwords, no Google account dependencies.
- **Inbound**: add your domain in the Resend dashboard, add the shown **MX
  record** at your registrar, then create a webhook subscribed to
  `email.received` pointing at `https://<host>/api/email/webhook`.

Code support (implemented in `email.service.ts` / `email.adapter.ts`):

- The webhook is signed with **Svix** (`svix-id` / `svix-timestamp` /
  `svix-signature` headers, `whsec_…` secret). Verification is implemented in
  `verifyResendSignature` and needs the **raw request body** — `app.ts` captures
  it for `/api/email/webhook`.
- The `email.received` event carries **metadata only** (no body/headers); the
  adapter reshapes it to the internal Mailgun-style shape and fetches the full
  content via the official `resend` SDK
  (`resend.emails.receiving.get(id)` → `GET /emails/receiving/:id`).
- **Attachments** — Resend keeps attachment bytes behind short-lived signed
  URLs addressed by attachment id. Inbound attachments carry their id
  (`resend_id`) in the persisted metadata, and the first one becomes the
  message media with a `resend-attachment://<emailId>/<attachmentId>` fileRef;
  `downloadMedia` resolves it on demand through
  `resend.emails.receiving.attachments.get` and stores the bytes in the inbox
  like any other channel (signed URLs are resolved fresh — never persisted).

Extra env vars:

| Variable | Purpose |
|----------|---------|
| `EMAIL_RESEND_WEBHOOK_SECRET` | `whsec_…` signing secret from the Resend webhook (fallback: `EMAIL_WEBHOOK_SECRET`) |
| `EMAIL_RESEND_API_KEY` | API key used to fetch body/headers after the webhook (required for inbound) |

Testing without DNS: `resend test` — any address at your free
`<id>.resend.app` receiving subdomain works before the custom domain's MX
record propagates.

### One-command provisioning (`npm run resend:setup`)

`server/scripts/resend-setup.js` provisions both Resend credentials via the
SDK and writes them into `server/.env` — no dashboard copy/paste:

```bash
# 1. Expose the webhook publicly
cd server && npm run telegram:tunnel      # or: npx ngrok http 8080

# 2. Provision (management key from resend.com/api-keys)
npm run resend:setup -- re_your_dashboard_key https://<tunnel-host>/api/email/webhook
```

What it does:

1. **Webhook** — creates an `email.received` webhook for the endpoint (or
   reuses an existing one pointing at the same URL) and stores its
   `signing_secret` as `EMAIL_RESEND_WEBHOOK_SECRET`. The secret is only
   returned on create/get/rotate — the script persists it so you never have
   to.
2. **API key** — created only when `EMAIL_RESEND_API_KEY` is not already set
   (Resend never shows a token twice, so an existing key is kept, not
   rotated). Requires a management key with `api-key` create permission.
3. **Health ping** — checks the webhook host answers, so a dead tunnel is
   caught immediately.

The management key (`RESEND_MANAGEMENT_API_KEY`) is only needed to run the
script; the generated delivery key is what the server uses. Restart the
backend afterwards so the new env vars are picked up.

Tunnel gotchas: `trycloudflare.com` URLs change on every restart (re-run
`resend:setup` with the new URL), and some networks drop the long-lived
tunnel connections — quick tunnels returning `530`/`000` after a minute are
a network problem, not a backend one. For production use a stable hostname
(deployed server or a named tunnel) instead of a quick tunnel.

Continuous integration: `.github/workflows/backend-ci.yml` builds the
server, runs the unit tests, then boots the backend against a MySQL 8
service and runs `test:e2e:email-suite` (mock-Resend inbound + full omni
inbox E2E) on every push/PR to `main` (manual trigger included).

---

## API reference

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/email/webhook` | signature | Provider inbound delivery (public) |
| `GET` | `/api/email/health` | none | Channel health (`configured` + SMTP reachability) |
| `POST` | `/api/email/messages` | agent | Reply on an email conversation (conversation-scoped) |
| `POST/DELETE` | `/api/email/conversations/:id/assign` | inbox member | Claim/unclaim |
| `POST` | `/api/email/setup-webhook` | admin+ | Echoes the webhook URL to configure at the provider |
| `GET` | `/api/email/webhook-info` | admin+ | Webhook configuration info |
| `DELETE` | `/api/email/webhook` | admin+ | Webhook de-registration stub |

Channel-agnostic inbox actions also work on email conversations:
`POST/PATCH /api/omni/conversations/:id/{assign,status,messages,media}`
(see `server/src/integrations/omni/omni.routes.ts`). The UI composer uses the
shared `/api/omni/...` reply route.

---

## Testing

```bash
# Unit tests (parsing, threading, signatures, sanitization)
cd server && node --test dist/test/email.adapter.test.js

# End-to-end (synthetic signed webhook → realtime fan-out → DB ground truth →
# dedupe → webhook security → inbox actions; cleanup is marker-scoped, FK-safe)
npm run test:e2e:email

# Also exercise the real SMTP outbound leg (sends one real email to the
# fixture address)
E2E_REAL_DELIVERY=1 npm run test:e2e:email
```

The e2e fixture uses `e2e-mail-customer@external.test` (override with
`E2E_EMAIL_CUSTOMER`); keep it across runs with `E2E_KEEP_FIXTURE=1`.

# Resend inbound path without a Resend account (mock Receiving API:
# content fetch → resend-attachment:// fileRef → signed-URL byte download)
npm run test:e2e:resend-mock

# Live-check the running backend's Svix verification (valid → 200,
# tampered → 401; side-effect free)
npm run resend:check

# Both of the above in one command (what CI runs)
npm run test:e2e:email-suite
