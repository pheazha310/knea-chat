# KneaChat Telegram Omni-Channel Integration

KneaChat acts as a support inbox for Telegram: customers message your bot,
the messages land in the KneaChat Unified Inbox (Messages view), and agents
reply from KneaChat without ever opening Telegram.

```
Telegram Customer → Telegram Bot → Telegram Webhook
  → KneaChat Express Backend → TelegramController (secret check)
  → TelegramChannelAdapter → OmniChannelService (contact / conversation / message)
  → MySQL (external_* ledger + existing chat tables)
  → WebSocket → KneaChat Unified Inbox → Support Agent
  → OmniChannelService → TelegramChannelAdapter → TelegramService → Telegram Bot API → Customer
```

## Architecture

KneaChat's omni-channel layer is channel-agnostic. Telegram is the first
channel; future channels (WhatsApp, email, …) plug in as adapters without
touching the shared engine.

| Piece | File | Responsibility |
| --- | --- | --- |
| Channel contract | `server/src/integrations/omni/omni.types.ts` | `ChannelAdapter` interface (`parseInbound`, `sendMessage`, `downloadMedia?`, `getHealth`, `setupWebhook?`, …). |
| Channel registry | `server/src/integrations/omni/channelRegistry.ts` | Maps channel keys (`telegram`) to their adapter instances. |
| Shared engine | `server/src/services/OmniChannel.service.ts` | Contact / conversation / message persistence, duplicate prevention, notifications, WebSocket fan-out, agent replies — identical for every channel. |
| Telegram API client | `server/src/integrations/telegram/telegram.service.ts` | Telegram Bot API only (`getMe`, `sendMessage`, `setWebhook`, `deleteWebhook`, `getWebhookInfo`, `getFile`, `downloadFile`). No DB, no Express. |
| Telegram adapter | `server/src/integrations/telegram/telegram.adapter.ts` | Everything Telegram-specific: update parsing (text + media), media download, outbound delivery, health, webhook administration. |
| HTTP handlers | `server/src/integrations/telegram/telegram.controller.ts` | Thin request/response handling + `X-Telegram-Bot-Api-Secret-Token` validation. |
| Data access | `server/src/repositories/externalContactRepository.ts` | `external_contacts`, `external_conversations`, `external_messages` tables. |
| Schema | `server/database/migrations/024_telegram_omni_channel.sql` | External tables + `external` role + omni-channel company. |

### Key design decisions

- **External identities are separate from internal ids.** A Telegram user id is
  stored in `external_contacts.external_contact_id` — never as a KneaChat
  `users.id`. Each external contact gets an internal *shadow user* row
  (role `external`, random unusable password, in the dedicated
  "Omni-Channel External" company) because the existing `conversations` /
  `conversation_members` / `messages` tables require `users` foreign keys.
  Shadow users can't log in and never appear in workspace people lists.
- **Existing chat tables are reused.** Telegram conversations are regular
  `direct` conversations; messages are regular `messages` rows. Conversation
  lists, message rendering, search and WebSocket broadcast work unchanged. The
  `external_*` ledger tables hold only channel-specific data.
- **One conversation per customer.** Subsequent customer messages reuse the
  same conversation. The ledger's unique `(channel, external_message_id)` key
  makes redelivered updates idempotent — Telegram retries are acknowledged and
  skipped, never double-stored.
- **Inbox membership.** Every internal user (role != `external`) is joined to a
  new Telegram conversation so it shows up in everyone's Messages view. Set
  `OMNI_INBOX_AGENT_IDS` (or the legacy alias `TELEGRAM_INBOX_AGENT_IDS`) to
  restrict the inbox to specific user ids.
- **Replies go through the channel endpoint.** The composer detects
  `channel === 'telegram'` conversations and calls `POST /api/telegram/messages`
  instead of the WebSocket send path. The Telegram chat id is resolved
  server-side from the stored contact — never trusted from the client. A
  message is persisted only after Telegram confirms delivery; `MessageService`
  also rejects internal sending into external conversations.
- **Channels own their webhooks.** `/api/telegram/webhook` validates
  `X-Telegram-Bot-Api-Secret-Token`. There is deliberately no generic
  `POST /api/omni/webhook/:channel` route, so no channel can be reached without
  its provider-specific secret check.

## Setup

### 1. Create the bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. Send `/newbot`, pick a name and username.
3. Copy the bot token (`123456789:AA...`). It is a **secret** — keep it in
   environment variables only, never commit it or expose it to the frontend.

### 2. Configure the server

Edit `server/.env` (copy from `.env.example`):

```env
TELEGRAM_BOT_TOKEN=123456789:AA...
TELEGRAM_API_URL=https://api.telegram.org
TELEGRAM_WEBHOOK_SECRET=choose-a-long-random-string
# Optional once your webhook URL is stable (used as the default by setup-webhook):
TELEGRAM_WEBHOOK_URL=https://abcd-123-45.ngrok-free.app/api/telegram/webhook
# Optional: restrict the inbox to specific KneaChat user ids:
# OMNI_INBOX_AGENT_IDS=3,7,22
```

`TELEGRAM_API_URL` may be `https://api.telegram.org` (the service appends
`/bot<token>/`) or `https://api.telegram.org/bot`. Never commit the real
`.env` (it is git-ignored) and never log the token.

### 3. Apply the database migration

```bash
npm run server -- db:setup   # or apply server/database/migrations/024_telegram_omni_channel.sql manually
```

The migration adds `external_contacts`, `external_conversations`,
`external_messages`, extends `users.role` with `'external'`, and inserts the
"Omni-Channel External" company.

### 4. Start the backend + frontend

```bash
npm run server   # API + WebSocket on :8080
npm run client   # React app on :3000
```

### 5. Expose the webhook (local development)

Telegram requires a public HTTPS URL. If the backend runs on
`http://localhost:8080`, tunnel it with [ngrok](https://ngrok.com):

```bash
ngrok http 8080
```

Take the assigned domain, e.g. `https://abcd-123-45.ngrok-free.app`. The
webhook URL is then:

```
https://abcd-123-45.ngrok-free.app/api/telegram/webhook
```

### 6. Register the webhook

Register the webhook URL so Telegram starts delivering updates:

```
POST /api/telegram/setup-webhook     (admin+)
Authorization: Bearer <JWT>
{ "webhookUrl": "https://abcd-123-45.ngrok-free.app/api/telegram/webhook" }
```

The body can be omitted when `TELEGRAM_WEBHOOK_URL` is set. Registration passes
the `secret_token` to Telegram automatically, so every delivery carries
`X-Telegram-Bot-Api-Secret-Token`.

Check the result with:

```
GET   /api/telegram/webhook-info     (admin+)   # current configuration
GET   /api/telegram/health           (public)   # { success, channel, connected, bot }
DELETE /api/telegram/webhook          (admin+)   # unregister
```

### 7. Send a test message

Open your bot in Telegram, press **Start**, then send
`Hello, I need help.` The message should appear in the KneaChat **Messages**
view as a `Telegram` conversation (`John Smith (Telegram)`). Reply from
KneaChat and the customer receives it in Telegram. In another browser window,
the message appears without a page refresh (WebSocket).

## API endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/telegram/webhook` | public (secret header) | Receives Telegram updates. Requires `X-Telegram-Bot-Api-Secret-Token` matching `TELEGRAM_WEBHOOK_SECRET` (401 otherwise). |
| GET | `/api/telegram/health` | public | `{ success, channel, connected, bot }` — never exposes the token. |
| POST | `/api/telegram/messages` | any agent | Agent reply `{ conversationId, text, replyToMessageId? }`. |
| POST | `/api/telegram/conversations/:id/assign` | any inbox member | Claim / assign an agent (`{ agentId? }`, defaults to self). |
| DELETE | `/api/telegram/conversations/:id/assign` | any inbox member | Unassign the agent. |
| POST | `/api/telegram/setup-webhook` | admin+ | `{ webhookUrl? }` — falls back to `TELEGRAM_WEBHOOK_URL`. |
| GET | `/api/telegram/webhook-info` | admin+ | Current webhook configuration. |
| DELETE | `/api/telegram/webhook` | admin+ | Unregister the webhook. |
| GET | `/api/omni/health/:channel` | public | Channel-agnostic health probe (e.g. `/api/omni/health/telegram`). |
| POST | `/api/omni/conversations/:id/messages` | any agent | Channel-agnostic reply (same engine as `/api/telegram/messages`). |
| PATCH | `/api/omni/conversations/:id/status` | any inbox member | Open / close an inbox conversation (`{ status: "open" \| "closed" }`). |
| POST | `/api/omni/conversations/:id/assign` | any inbox member | Channel-agnostic assign (defaults to self). |
| DELETE | `/api/omni/conversations/:id/assign` | any inbox member | Channel-agnostic unassign. |

A Telegram conversation is reopened automatically when the customer sends a new
message after it was closed.

## WebSocket events

| Event | Payload | When |
| --- | --- | --- |
| `receive_message` | `{ type, message, channel: "telegram" }` | Inbound customer message and outbound agent reply are broadcast to every inbox member (standard chat event with the `channel` tag, so the existing listeners render them live). |
| `omni_assignment_changed` | `{ data: { conversationId, assignedAgentId } }` | An agent claims / releases an inbox conversation. |
| `omni_conversation_status_changed` | `{ data: { conversationId, status } }` | An inbox conversation is opened / closed. |
| `notification` | `{ data: { type: "new_message", … } }` | Per-member unread notifications follow existing message-notification preferences. |

The client keeps `telegram_assignment_changed` as a legacy alias.

## Database changes (migration 024)

- `users.role` extended with `'external'` (shadow users for external contacts).
- New company `Omni-Channel External` (`omni-channel.external`).
- `external_contacts` — one row per `(channel, external_contact_id)`, mapping
  the provider identity to its internal shadow user. Unique
  `(channel, external_contact_id)`.
- `external_conversations` — maps a KneaChat `conversations.id` to an external
  contact + channel, with `status` (`open`/`closed`) and optional
  `assigned_agent_id`. Unique `(contact_id, channel)`.
- `external_messages` — ledger rows with `direction` (`inbound`/`outbound`),
  `sender_type` (`customer`/`agent`/`system`), `external_message_id` and
  `external_timestamp`. Unique `(channel, external_message_id)` prevents
  duplicate webhook processing.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | *(empty)* | Bot token from BotFather. The server starts without it; the bot simply reports "not configured". |
| `TELEGRAM_API_URL` | `https://api.telegram.org` | Bot API base. The service appends `/bot<token>/` unless the base already ends in `/bot`. |
| `TELEGRAM_WEBHOOK_SECRET` | *(empty)* | Secret verified on every webhook delivery. **Always set in production.** |
| `TELEGRAM_WEBHOOK_URL` | *(empty)* | Public HTTPS webhook URL; default for `POST /api/telegram/setup-webhook`. |
| `OMNI_INBOX_AGENT_IDS` | *(empty = all internal users)* | Comma-separated KneaChat user ids that see the omni inbox. |
| `TELEGRAM_INBOX_AGENT_IDS` | *(empty)* | Legacy alias for `OMNI_INBOX_AGENT_IDS`. |

## Security

- The token lives only in environment variables; `.env` is git-ignored.
- The webhook validates `X-Telegram-Bot-Api-Secret-Token` and returns `401` on
  a missing/incorrect secret **without processing**. The secret is never logged
  and never returned by an API.
- Telegram API calls happen server-side only; the token is never sent to the
  client, logged, or included in API responses.
- Agents must authenticate (JWT) before replying and must be members of the
  conversation. Chat ids are resolved from the database, never from client
  input.
- Webhook administration (`setup-webhook`, `webhook-info`, `webhook`) is
  restricted to `admin+` roles via the project's existing auth middleware.
- Telegram customer ids are never used as internal KneaChat user ids.
- Shadow users get random, unusable passwords and the `external` role.
- Errors are sanitized; the bot token and webhook secret never appear in error
  output or logs.
- Outbound messages are persisted only after Telegram confirms delivery — a
  rejected send returns `502` and stores nothing.
- All SQL goes through the repository layer's parameterized queries.

## Testing

```bash
npm run server -- test          # full backend suite (includes omni-channel tests)
```

The relevant tests live in `server/test/`:

- `telegram.service.test.ts` — `getMe`, `sendMessage`, `setWebhook`,
  `deleteWebhook`, `getWebhookInfo`, API/network error handling (HTTP client
  stubbed — no real token or network).
- `telegram.adapter.test.ts` — update parsing (text/media, ignored updates),
  media download, outbound delivery, health + webhook administration.
- `omniChannel.service.test.ts` — contact/conversation/message creation +
  reuse, duplicate prevention, agent reply (success + Telegram failure),
  assignment, status, health.
- `telegram.controller.test.ts` — webhook secret validation (401/200),
  malformed-update handling, and `setup-webhook` env/body URL resolution.

All Telegram API requests are mocked; no real bot token is used in tests.

## Media messages

Photos, voice notes, documents, videos, audio and stickers sent by the
customer are downloaded from Telegram's file server through the adapter and
stored as regular `image` / `voice` / `file` messages with an attachment under
the shared `uploads/` directory, so agents see them in the inbox. A caption (or
the file name) becomes the message preview. If Telegram cannot resolve or
download the file, the message is still recorded (without an attachment) so
nothing is silently lost.

## Agent assignment & status

Telegram conversations can be claimed by an agent so the team knows who is
handling the customer:

```
POST   /api/telegram/conversations/:id/assign    # { agentId? } — defaults to self
DELETE /api/telegram/conversations/:id/assign    # unassign
PATCH  /api/omni/conversations/:id/status        # { status: "open" | "closed" }
```

Only conversation members can assign, and only members can be assigned. The
assignee is returned in the conversation list as `assigned_agent_id` /
`assigned_agent_name`, and every connected agent is live-synced via the
`omni_assignment_changed` WebSocket event. In the Messages view, an unassigned
Telegram conversation shows a **Claim** button; an assigned one shows the
agent's name with an unassign action.

## Known limitations / assumptions

- Private-chat **text and media** messages are handled. Edited messages,
  groups and channels are acknowledged and ignored.
- Telegram conversations appear in every internal user's inbox by default
  (use `OMNI_INBOX_AGENT_IDS` to restrict).
- Notifications for channel messages follow each member's existing message
  notification preferences.
- Adding more channels later (WhatsApp, email, …) means implementing one
  `ChannelAdapter` (parse + send + health) and registering it in
  `server/src/container.ts` — the `external_*` tables and shared engine are
  already channel-agnostic.