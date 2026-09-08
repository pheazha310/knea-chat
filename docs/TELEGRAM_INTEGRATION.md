# KneaChat Telegram Omni-Channel Integration

KneaChat can act as a support inbox for Telegram: customers message your bot,
the messages land in the KneaChat Unified Inbox (Messages view), and agents
reply from KneaChat without ever opening Telegram.

```
Telegram Customer → Telegram Bot → Telegram Webhook
  → KneaChat Express Backend → Telegram Controller → TelegramInboxService
  → Contact / Conversation / Message logic → MySQL
  → WebSocket → KneaChat Unified Inbox → Support Agent
  → TelegramInboxService → TelegramService → Telegram Bot API → Customer
```

## How it works (architecture)

| Piece | File | Responsibility |
| --- | --- | --- |
| API client | `server/src/integrations/telegram/telegram.service.ts` | Telegram Bot API only (`getMe`, `sendMessage`, `setWebhook`, `deleteWebhook`, `getWebhookInfo`). No DB, no Express. |
| Application service | `server/src/services/TelegramInbox.service.ts` | Webhook orchestration, find-or-create contact/conversation/message, agent replies, health + webhook administration. |
| HTTP handlers | `server/src/integrations/telegram/telegram.controller.ts` | Thin request/response handling + webhook secret validation. |
| Data access | `server/src/repositories/externalContactRepository.ts` | `external_contacts`, `external_conversations`, `external_messages` tables. |
| Schema | `server/database/migrations/024_telegram_omni_channel.sql` | Tables + `external` role + omni-channel company. |

### Key design decisions

- **External identities are separate from internal ids.** A Telegram user id is
  stored in `external_contacts.external_contact_id` — never as a KneaChat
  `users.id`. Each external contact gets an internal *shadow user* row
  (role `external`, in the dedicated "Omni-Channel External" company) because
  the existing `conversations` / `conversation_members` / `messages` tables
  require `users` foreign keys. Shadow users can't log in and never appear in
  workspace people lists or search.
- **Existing chat tables are reused.** Telegram conversations are regular
  `direct` conversations; messages are regular `messages` rows. The existing
  conversation list, message rendering, search and WebSocket broadcast work
  unchanged. The external ledger tables store the channel-specific data.
- **One conversation per customer.** Subsequent customer messages reuse the
  same conversation (never one conversation per message). The external
  message ledger's unique `(channel, external_message_id)` key makes
  redelivered updates idempotent.
- **Inbox membership.** Every internal user (role != `external`) is joined to
  a new Telegram conversation so it shows up in everyone's Messages view. Set
  `TELEGRAM_INBOX_AGENT_IDS` to restrict the inbox to specific user ids.
- **Replies go through the channel endpoint.** The composer detects
  `channel === 'telegram'` conversations and calls
  `POST /api/telegram/messages` instead of the WebSocket send path. The
  Telegram chat id is resolved server-side from the stored contact — never
  trusted from the client. The server also rejects internal message creation
  into external conversations (via `MessageService`), so a message can never
  be persisted without being delivered.
- **WebSocket events follow existing conventions.** Inbound and outbound
  channel messages are broadcast as the standard `receive_message` event with
  an added `channel: 'telegram'` field, so the existing client listeners
  render them live.

## Setup

### 1. Create the bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. Send `/newbot`, pick a name and username.
3. Copy the bot token (`123456789:AA...`).

### 2. Configure the server

Edit `server/.env` (copy from `.env.example`):

```env
TELEGRAM_BOT_TOKEN=123456789:AA...
TELEGRAM_API_URL=https://api.telegram.org/bot
TELEGRAM_WEBHOOK_SECRET=choose-a-long-random-string
# TELEGRAM_INBOX_AGENT_IDS=1,2,3   # optional: restrict the inbox to these users
```

Never commit the real `.env` (it is git-ignored) and never hard-code or log
the token.

### 3. Apply the database migration

```bash
npm run server -- db:setup   # or run server/database/migrations/024_telegram_omni_channel.sql manually
```

### 4. Start the backend + frontend

```bash
npm run server   # API + WebSocket on :8080
npm run client   # React app on :3000
```

### 5. Expose the webhook (local development)

Telegram requires a public HTTPS URL. Use [ngrok](https://ngrok.com):

```bash
ngrok http 8080
```

Take the assigned domain, e.g. `https://abcd-123-45.ngrok-free.app`.

### 6. Register the webhook

Register the webhook URL so Telegram starts delivering updates:

```
POST /api/telegram/setup-webhook     (admin+)
Authorization: Bearer <JWT>
{ "webhookUrl": "https://abcd-123-45.ngrok-free.app/api/telegram/webhook" }
```

Verify with:

```
GET  /api/telegram/webhook-info      (admin+)
GET  /api/telegram/health            (public)
DELETE /api/telegram/webhook         (admin+)
```

### 7. Send a test message

Open your bot in Telegram, press **Start**, then send
`Hello, I need help.` The message should appear in the KneaChat **Messages**
view as a `Telegram` conversation (`John Smith (Telegram)`). Reply from
KneaChat and the customer receives it in Telegram.

## API endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/telegram/webhook` | public (secret header) | Receives Telegram updates. Requires `X-Telegram-Bot-Api-Secret-Token` matching `TELEGRAM_WEBHOOK_SECRET` (401 otherwise). |
| GET | `/api/telegram/health` | public | `{ success, channel, connected }` — never exposes the token. |
| POST | `/api/telegram/messages` | any agent | Agent reply `{ conversationId, text, replyToMessageId? }`. |
| POST | `/api/telegram/conversations/:id/assign` | any inbox member | Claim / assign an agent (`{ agentId? }`, defaults to self). |
| DELETE | `/api/telegram/conversations/:id/assign` | any inbox member | Unassign the agent. |
| POST | `/api/telegram/setup-webhook` | admin+ | `{ webhookUrl }`. |
| GET | `/api/telegram/webhook-info` | admin+ | Current webhook configuration. |
| DELETE | `/api/telegram/webhook` | admin+ | Unregister the webhook. |

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | *(empty)* | Bot token from BotFather. Server starts without it; the bot simply reports "not configured". |
| `TELEGRAM_API_URL` | `https://api.telegram.org/bot` | Bot API base (must end with `/bot`). |
| `TELEGRAM_WEBHOOK_SECRET` | *(empty)* | Secret verified on every webhook delivery. **Always set in production.** |
| `TELEGRAM_INBOX_AGENT_IDS` | *(empty = all internal users)* | Comma-separated KneaChat user ids that see the Telegram inbox. |

## Security

- Token lives only in environment variables; `.env` is git-ignored.
- The webhook validates `X-Telegram-Bot-Api-Secret-Token` and returns `401`
  on mismatch without processing.
- Telegram API calls are server-side only; the token is never sent to the
  client, logged, or included in API responses.
- Agents must authenticate (JWT) before replying and must be members of the
  conversation. Chat ids are resolved from the database, not from client input.
- Telegram customer ids are never used as internal KneaChat user ids.
- Shadow users get random, unusable passwords and the `external` role.
- Errors are sanitized (`error.middleware` + `getSafeErrorMessage`); the bot
  token never appears in error output.

## Testing

```bash
npm run server -- test          # full backend suite (includes Telegram tests)
```

The Telegram tests are in `server/test/`:

- `telegram.service.test.ts` — `getMe`, `sendMessage`, `setWebhook`,
  `deleteWebhook`, `getWebhookInfo`, API/network error handling (HTTP client
  stubbed — no real token or network).
- `telegram.inbox.test.ts` — webhook flow, contact/conversation/message
  creation + reuse, duplicate prevention, agent reply, Telegram API failure.
- `telegram.controller.test.ts` — webhook secret validation (401/200) and
  malformed-update handling.

All Telegram API requests are mocked; no real bot token is used in tests.

## Media messages

Photos, voice notes, documents, videos, audio and stickers sent by the
customer are downloaded from Telegram's file server and stored as regular
`image` / `voice` / `file` messages with an attachment under the shared
`uploads/` directory, so agents see them in the inbox. A caption (or the file
name) becomes the message preview. If Telegram cannot resolve or download the
file, the message is still recorded (without an attachment) so nothing is
silently lost.

## Agent assignment

Telegram conversations can be claimed by an agent so the team knows who is
handling the customer:

```
POST   /api/telegram/conversations/:id/assign    # { agentId? } — defaults to self
DELETE /api/telegram/conversations/:id/assign    # unassign
```

Only conversation members can assign, and only members can be assigned. The
assignee is returned in the conversation list as `assigned_agent_id` /
`assigned_agent_name`, and every connected agent is live-synced via the
`telegram_assignment_changed` WebSocket event. In the Messages view, an
unassigned Telegram conversation shows a **Claim** button; an assigned one
shows the agent's name with an unassign action.

## Known limitations / assumptions

- Private-chat **text and media** messages are handled. Edited messages,
  groups and channels are acknowledged and ignored.
- Telegram conversations appear in every internal user's inbox by default
  (use `TELEGRAM_INBOX_AGENT_IDS` to restrict).
- Notifications for channel messages follow each member's existing message
  notification preferences.
- Adding more channels later (WhatsApp, email, website widget…) means adding a
  new adapter: a channel API client, a find-or-create contact/conversation
  path, and a reply endpoint — the `external_*` tables are channel-agnostic.