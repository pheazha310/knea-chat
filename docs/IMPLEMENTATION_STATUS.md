# KneaChat — Implementation Status

**Document Version:** 2.0
**Last Updated:** August 2026
**Project Status:** MVP Complete ✅

---

## 📊 Overall Progress

| Category                 | Status               | Completion |
| ------------------------ | -------------------- | ---------- |
| Server Foundation        | ✅ Complete          | 100%       |
| REST API                 | ✅ Complete          | 100%       |
| WebSocket                | ✅ Complete          | 100%       |
| Database Layer           | ✅ Complete          | 100%       |
| Authentication & Authz   | ✅ Complete          | 100%       |
| Client App               | ✅ Complete          | 100%       |
| Mentions & Attachments   | ✅ Complete          | 100%       |
| Admin / Management UI    | ✅ Complete          | 100%       |
| Testing                  | ⚠️ In Progress       | 20%        |
| Deployment               | ⚠️ In Progress       | 30%        |
| **Overall (MVP)**        | **✅ Complete**      | **~90%**   |

> Note: earlier versions of this document described a backend-only skeleton
> ("Database integration: 0%"). The project has since shipped the full
> database layer, services, WebSocket integration, and a complete React
> client. This document reflects the current state.

---

## 🛡️ Role Matrix (RBAC)

Roles are hierarchical — higher roles inherit every permission of the roles
below them (`super_admin > admin > manager > employee`). They are enforced on
API routes (`auth.middleware.ts` → `isAtLeast` / `authorizeAtLeast`), inside
services (`TeamService`, `ChannelService`, `UserService`), and in the client
routing/UI. The canonical server definitions live in `server/src/utils/roles.ts`;
friendly display labels live in `client/src/utils/roles.ts`.

| Role          | Key           | Scope                                   | Key permissions                                                                                          |
| ------------- | ------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Super Admin** | `super_admin` | Entire platform                         | Manage organizations (workspaces) and their admins, manage all users' roles, platform settings, maintenance mode |
| **Company Admin** | `admin`     | Company / workspace                     | Manage company users (create, change role, enable/disable, delete), teams, channels                      |
| **Manager**   | `manager`     | Assigned teams                          | Create teams/channels, manage assigned teams (edit, delete, add/remove members), manage their channels   |
| **Employee**  | `employee`    | Personal workspace                      | Chat, join channels/teams, edit own profile; may create channels inside teams they belong to             |

Enforcement notes:

- Teams: creation requires **manager+**; management (edit/delete) is scoped to
  assigned teams — admins & super admins manage every team, managers only the
  teams they are a member of, and the team creator manages their own team's
  details. **Adding/removing team members** is manager+ (assigned teams) **or
  the team creator for their own team**; other employees cannot.
- Channels: creation is open to managers+ (anywhere they may create, incl.
  standalone channels) and to **employees inside teams they belong to**;
  standalone channel creation is manager+ only. Managing channels is scoped:
  admins & super admins manage every channel, managers the channels inside
  their assigned teams, and the channel admin/creator their own.
- Users: create/delete require **admin+**; role changes require admin+ and are
  further restricted by `canAssignRole` (only a Super Admin may assign
  `super_admin`). Users may always edit their own profile.
- Organizations & system settings: **super_admin only**.
- Maintenance mode blocks every role except `super_admin`.

---

## ✅ What Works Now (SRS coverage)

### Authentication & Users (US-01..US-04)
- [x] Login / logout / register with JWT + bcrypt, 24h token, `user_sessions`
- [x] **Login history + session management** — every sign-in is recorded
      (device, IP, time) in `user_sessions` and **kept after logout** (soft
      sign-out via `logged_out_at`, migration 024) so the history is never
      wiped. Users review their own recent sign-ins with an
      Active / Expired / Signed-out status (`GET /api/auth/sessions`) and can
      **sign out all other devices** (`POST /api/auth/sessions/revoke-others`,
      current session excluded); admins/super admins can inspect any
      workspace user's login history (`GET /api/users/:id/sessions`, company
      scoping enforced — company admins are limited to their own company).
      UI: Profile → **Login history & sessions**; live E2E
      (`server/e2e/sessions.e2e.js`, `npm run test:e2e:sessions` — 23 checks
      against a running backend: sign-in recording, history status mapping,
      revoke-others, soft logout preservation, admin scoping, metric cross-check).
      Each login now issues a **unique JWT (`jti` claim)** — previously
      identical payloads produced identical tokens, so concurrent sign-ins of
      the same user shared one token/hash and "current session" lookups were
      ambiguous (verified in headless Chrome: Profile renders the three
      devices, "Sign out all other devices" keeps only the current one)
- [x] Token refresh, password reset flow (forgot / reset / change password)
- [x] Rate limiting on authentication endpoints
- [x] Profile page — edit name, job title, status; change password
- [x] Role-based access: admin / manager / employee
- [x] Admin user management: create, change role, disable/enable, delete

### Messaging (US-06..US-10, FR-08..FR-11)
- [x] Direct messages, group chats, channel conversations, and **team
      conversations** (one shared room per team; auto-joins all team members)
- [x] **Team conversation access control** — team conversations are restricted
      to team members + managers/admins (super_admin/admin/manager). Opening,
      message history, sending, reactions, pinning, WS joins, search results,
      and the conversation list are all scoped; non-members see a lock icon
      and an explanatory toast instead of the chat. A data migration removed
      stale auto-joined members from existing team conversations
- [x] Real-time send/receive via WebSocket with DB persistence
- [x] Message edit, delete (soft delete), reactions
- [x] **Reactions are idempotent + real-time** — `POST/DELETE /reactions` never
      ​400 on stale client state (re-adding/removing a reaction succeeds), and
      `message_reacted`/`message_unreacted` WebSocket events keep every
      member's reaction list in sync
- [x] **Replies** (reply_to with quoted context in the UI)
- [x] **Mentions** — `@First Last` parsing, `mention` notifications,
      real-time notification events, autocomplete + highlighting in the UI
- [x] **React to message notifications** — `mention` / `new_message` rows in
      the bell popover and the Notifications view offer a quick **React**
      action (same emoji set as the chat hover bar): picking an emoji adds it
      to the underlying message through the existing reactions API
      (idempotent — members see it live via `message_reacted`), picking it
      again removes it, and a successful reaction acknowledges the
      notification (marks it read). Mirrors the Reply affordance on the same
      rows, so you never have to leave the notifications surface
- [x] **Click a message notification to view the full message** — the server
      only stores a 120-char preview on `mention` / `new_message` rows, so
      clicking the row (bell popover or the Notifications page) opens a modal
      that fetches the real message (`GET /api/messages/:id`, access-checked
      like every other message read) and shows the complete untruncated body
      with the sender, timestamp, conversation context, attachments and the
      same React / Reply affordances as the row. Its **Open in conversation**
      button closes the modal and jumps into the chat, flash-highlighting the
      message when it is within the loaded window; clicking also marks the
      notification read. Deleted or inaccessible messages get a graceful
      "no longer available" state that still offers the conversation link
- [x] **Attachments** — file upload with type (extension + MIME) and size
      validation, attachment chips, static file serving
- [x] **Pinning** — pin/unpin messages with real-time broadcast

### Workplace (US-11..US-14, FR-05..FR-07)
- [x] Teams — create, list, view members, add/remove members, team channels,
      shared team conversations (open from the sidebar; member changes sync
      conversation membership)
- [x] **Announcements (FR-24)** — announcements published by managers/admins
      (`/api/announcements`), dedicated sidebar view with a composer,
      real-time `announcement_*` WebSocket events, and an `announcement`
      notification for recipients (bell + Notifications)
- [x] **Announcement targeting, pinning, scheduling & read confirmation
      (migration 022)** — announcements can target the **whole company**, a
      **department**, or a **team** (non-managers only see what's aimed at
      them; managers see everything incl. drafts); **pinned** announcements
      sort to the top with an amber accent; **scheduled** announcements go
      live at a chosen time via the server scheduler (30s tick, idempotent)
      and can be edited/published-now before that; **read confirmation** —
      opening an announcement marks it read (`POST /api/announcements/:id/read`),
      every card shows `read / total` progress, and managers get a "Seen by"
      modal listing who read what and when (`GET /api/announcements/:id/reads`)
      — with `announcement_reads` ledger rows and scoped WebSocket fan-out so
      department/team announcements only reach their audience
- [x] **Departments (FR-06)** — company-scoped CRUD endpoints
      (`/api/departments`), Admin console tab with create/rename/delete, and
      a department picker when creating users (departments with members are
      protected from deletion)
- [x] Channels — create (public/private, optional team), archive/delete,
      member management, self-join on open
- [x] Group chat creation (1 person → DM, 2+ → group)

### Real-Time (SRS §11, §17)
- [x] **Presence snapshot** — a freshly connected client immediately learns
      who is already online (`presence_snapshot` on connect), so logins and
      reconnects show real presence instead of everyone-offline
- [x] **Active-view read state** — messages arriving in the conversation the
      user is currently viewing are auto-marked read (no phantom unread
      badges/toasts); badges light up correctly as soon as the user is on
      another view
- [x] Authenticated WebSocket connections

### Employee Working Time & Attendance (Calendar)
- [x] **Work schedules** — per-employee weekly schedule stored in MySQL
      (`work_schedules`); defaults (Mon–Fri 08:00–17:00, 60 min break,
      480 required minutes, Sat/Sun off) are materialized lazily, so nothing
      is hard-coded at request time; managers customize any employee's week
      via the Work Schedule editor (`GET/POST /api/work-schedules`)
- [x] **Clock In / Clock Out** — server-generated timestamps only, one record
      per employee per date (unique key), clock-out requires clock-in,
      duplicate clock-ins/outs rejected, rate-limited endpoints; optional
      Start/End Break with `break_records`
- [x] **Attendance calculation on the backend** — late (from scheduled start),
      early leave (from scheduled end), under-time, overtime (above required
      minutes), and the status (present / late / absent / leave / holiday /
      day_off / early_leave / under_time / overtime) are computed in
      `AttendanceService`, never on the client
- [x] **Employee calendar** — current month with working days / day off /
      holiday / leave / attendance status per day, required vs actual hours,
      overtime, late & early-leave minutes; clicking a date opens a detail
      panel; monthly summary (working days, present/late/absent/leave, hours,
      under-time, overtime, attendance rate)
- [x] **Leave management** — employees submit annual / sick / personal / unpaid
      requests; managers approve or reject; approved leave overrides normal
      attendance and is never counted as absence; overlapping requests blocked
- [x] **Overtime requests** — employees request overtime for a work date
      (minutes + reason, linked to the day's attendance record when one
      exists); managers approve / reject from the attendance console
      (`POST/GET /api/overtime`, `PUT /api/overtime/:id/approve|reject`, table
      `overtime_records` with a `date` column added in migration 018)
- [x] **Holiday management** — managers create public holidays (e.g. Pchum Ben);
      holidays override attendance with 0 required hours and block clock-in
- [x] **Manager dashboard + employee×day table** — today's totals (present /
      late / absent / on leave / day off / currently working / on break),
      filters by department & status, per-employee drill-down calendar and
      schedule editor, monthly report endpoint
- [x] **WebSocket real-time** — `attendance:clocked_in/clocked_out/status_changed/break_started/break_ended`
      events update the manager dashboard without a page refresh; the flow is
      Employee → Express → MySQL → Redis Pub/Sub → WebSocket → dashboard
- [x] **Redis** — attendance event pub/sub fan-out across server instances and
      a short-TTL dashboard cache (invalidated on clock/break events), with a
      transparent in-memory fallback when Redis is down; MySQL remains the
      source of truth
- [x] **Database (migration 017)** — `work_schedules`, `attendance_records`,
      `break_records`, `leave_requests`, `holidays`, `overtime_records` with
      foreign keys and indexes
- [x] **Tests** — `server/test/attendance.service.test.ts` (35 tests: schedule
      defaults/customization, clock-in/out calculations, breaks, month
      summary, manager dashboard roll-up, employee×day table + report, leave &
      holiday rules); client store + view tests
      (`client/src/store/attendanceStore.test.ts`,
      `client/src/components/views/attendanceViews.test.tsx`); live E2E script
      (`server/e2e/attendance.e2e.js`, `npm run test:e2e:attendance` — 52
      checks covering clock in/out, WebSocket events, schedules, leave
      approval, holidays, overtime and permissions)

### Files & Documents (Shared Files)
- [x] **Company shared files** — upload (drag & drop) to the company public
      area, type filters + live search, preview, download, delete, per-user
      permissions (`view`/`edit`/`delete`/`manage`) and version history with
      re-uploads (`shared_files`, `file_versions`, `file_permissions`)
- [x] **Team files (migration 019)** — a `team_id` on `shared_files` scopes a
      file to a team's own file area; uploads to a team are restricted to team
      members + that company's managers/admins, are stored private (never
      leaked company-wide), and are visible to every team member. The Files
      view has **Shared files / Team files** tabs with a team picker; managers
      can open any team
- [x] **Sharing to teams & conversations** — a `file_shares` table links a
      file to extra destinations whose members gain access (team members via
      `team_members`, conversation members via `conversation_members`,
      managers/admins company-wide). Access checks (`canAccess`) cover public,
      uploader, explicit permissions, home-team membership, and share
      destinations. UI: Share action per file with an add/remove destination
      modal; sharing is idempotent, owner/manage-gated, cross-company sharing
      is blocked
- [x] **API** — `GET /api/shared-files/team/:teamId`,
      `GET|POST /api/shared-files/:id/shares`,
      `DELETE /api/shared-files/:id/shares/:shareId`; upload accepts an
      optional `team_id`
- [x] **Embed in chat** — `POST /api/shared-files/:id/embed` shares a file
      INTO a conversation as a `file`-type message (anyone with file access
      who is part of the conversation). It grants the conversation access via
      `file_shares`, posts the message through the normal message pipeline
      (notifications for recipients), and live-broadcasts `receive_message`
      to connected members exactly like a chat upload — no page refresh
      needed. UI: the Share dialog's conversation option now posts the file
      into that chat
- [x] **Tests** — `server/test/sharedFile.service.test.ts` (18 tests: team
      upload/listing access, share rules for teams & conversations,
      unshare permissions, embedding into conversations, idempotency); live
      E2E (`server/e2e/shared-files.e2e.js`, `npm run test:e2e:files` — 28
      checks covering uploads, team visibility, access scoping, embedding as
      a chat message, sharing and cleanup)

### Tasks & Work Management
- [x] **Create tasks** — title, description, due date, priority (low/medium/high),
      status (open / in_progress / completed), assignee (`/api/tasks`)
- [x] **Assign tasks** — managers/admins assign to anyone in the company;
      employees create personal tasks (or team tasks in teams they belong to)
- [x] **Team vs personal tasks** — a `team_id` scopes a task to a team (visible
      to all members); tasks without one are personal (assignee + creator).
      The Tasks view filters by All / Personal / per-team, and the create &
      edit forms pick the team
- [x] **Kanban board** — List ⇄ Board toggle; the board shows Open / In
      progress / Done columns with drag-and-drop status changes (native HTML5
      DnD, no new dependency), priority dot, due-date chip, assignee avatar
      and team badge on each card
- [x] **Task detail modal** — click any task (list or board) for a detail view:
      status select, editable title/description/due date/priority/assignee/team
      (managers & creators), comments with delete, and attachments with
      upload / download / delete
- [x] **Task comments** — add/list/delete on any task you can view
      (`/api/tasks/:id/comments`)
- [x] **Task attachments** — validated upload (type + size), list with size &
      uploader, download, delete (`/api/tasks/:id/attachments`)
- [x] **Task notifications** — assignment produces a `task_assigned`
      notification (bell + real-time WS event) for the assignee; the server
      scheduler sends one `task_deadline` reminder per due task (idempotent via
      `deadline_reminded_at`). Both honor the user's notification preferences
      (category `tasks` in Notifs → Preferences)
- [x] **Task search & filters** — live text search (debounced) plus status,
      priority and scope (team/personal) filters, with per-status counts on
      the board and overdue highlighting
- [x] **API** — `GET|POST /api/tasks`, `PATCH|DELETE /api/tasks/:id`,
      `GET|POST /api/tasks/:id/comments`, `DELETE /api/tasks/:id/comments/:commentId`,
      `GET|POST /api/tasks/:id/attachments`,
      `DELETE /api/tasks/:id/attachments/:attachmentId`; role + team scoping
      enforced in `TaskService`/`TaskRepository`
- [x] **Tests** — `server/test/task.service.test.ts` + live E2E
      (`server/e2e/tasks-notifications.e2e.js`, `npm run test:e2e:tasks`)

### Administration (module 10 — Company Admin + Super Admin)
- [x] **Audit logs** — `audit_logs` ledger records every administrative action
      (user created/updated/deleted, department & team changes, member adds/
      removes, announcements, organization create/update/delete, platform
      settings, workspace settings, permission changes, plan changes) with
      actor, role, IP and JSON details. Company Admins read their workspace
      trail (`GET /api/audit-logs`), Super Admins read the platform trail
      (`GET /api/audit-logs/platform`, `?company_only=platform` filters to
      platform-scope actions); logging is best-effort and can never break the
      action itself
- [x] **Manage permissions** — a permission catalog
      (`server/src/utils/permissions.ts`) exposes discretionary capabilities
      (create/manage teams, manage team members, manage channels, publish
      announcements) on top of the fixed role hierarchy. Company Admins see
      the full matrix and may **restrict** capabilities for the manager role
      (`role_permissions` overrides); the same policy is consulted by the
      route gates (team create/delete, announcements) and inside
      `TeamService` / `ChannelService`, so restrictions are enforced —
      admins & super admins always keep every permission
- [x] **Company settings + Security settings** — `company_settings` per
      workspace (key/value, layered over the platform `system_settings`):
      workspace profile (name/logo) plus feature toggles (uploads, reactions,
      pinning, upload size cap) and password policy. Enforcement points
      (message upload, reactions, pin/unpin, admin-created users, password
      change/reset) merge workspace + platform policy: a disabled platform
      feature stays off, workspace caps never exceed platform caps, and the
      stricter password minimum wins (`GET/PATCH /api/company-settings`)
- [x] **Subscriptions / plan management** — workspaces carry a plan
      (`free` 10 seats / `pro` 50 / `enterprise` unlimited) with status,
      expiry and billing email on the `companies` row (migration 023;
      seeded/imported workspaces keep Enterprise so nothing deployed is
      retroactively capped). Super Admins manage every workspace's plan
      (`GET/PATCH /api/subscriptions`); seat limits are enforced when admins
      create users and on public registration (`SubscriptionService`);
      Company Admins see their own plan + usage
      (`GET /api/company-settings/plan`)
- [x] **Platform monitoring** — live, DB-derived metrics for the Super Admin
      monitoring tab (`GET /api/admin/metrics`): global totals (workspaces,
      users, teams, channels, departments, messages, conversations, files,
      tasks, meetings, announcements, active sessions), online presence,
      today's activity, attachment storage and a 7-day message chart
- [x] **UI** — Admin console gained **Settings & Security**, **Permissions**
      and **Audit Logs** tabs; the Super Admin console gained **Platform
      Monitoring** and **Subscriptions & Plans** tabs
- [x] **Tests** — `server/test/auditLog.service.test.ts`,
      `server/test/companySetting.service.test.ts`,
      `server/test/permission.service.test.ts` (incl. Team/Channel policy
      enforcement), `server/test/subscription.service.test.ts`,
      `server/test/platformMetric.service.test.ts` (47 new tests), plus a
      live API smoke run covering metrics, plan changes, settings,
      permission toggles and both audit trails

### Real company data
- [x] **Company importer** (`npm run import:company -- <file.json|csv>`,
      template at `server/scripts/data/real-company.example.json`) — creates a
      NEW company (demo data untouched) with departments, users (per-user
      passwords), teams + members, channels, and shared team conversations;
      prints all credentials for distribution. Users can also be added by hand
      through the Admin console
- [x] send_message / receive_message / message_updated / message_deleted
- [x] typing_start / typing_stop
- [x] user_online / user_offline / user_status_changed
- [x] join_channel / leave_channel, ping/pong heartbeat
- [x] message_pinned / message_unpinned
- [x] notification events (mention + new message) → live bell updates
- [x] Client reconnect with exponential backoff + offline queue

### Search (US-17, FR-16)
- [x] **Quick search** — message search (with conversation context) and user
      search (`/api/search/messages|users`) plus the ⌘K modal that jumps
      straight into a conversation or DM
- [x] **Global search view (7 scopes)** — a dedicated Search page searches the
      whole workspace at once: **messages, people, teams, channels, files,
      meetings and tasks**. One debounced query box returns a grouped
      overview — top hits per scope with match totals — and every scope
      expands into its own tab with pagination ("Show all N" / Load more).
      Result rows deep-link to their entity: message hits open the
      conversation, people open a DM, teams/channels open their chat, and
      files / meetings / tasks jump to their own views
- [x] **Filters** — Person, Team, Department, File type (image / video / audio /
      pdf / word / excel / powerpoint / archive / text), Message type, and an
      inclusive Date range (from/to). Each filter narrows only the scopes
      where it is meaningful; a pure-filter query (no text) is supported,
      active filters can be cleared in one click, and query occurrences are
      highlighted in every result
- [x] **Access-scoped results** — every scope mirrors the rules of the entity's
      own endpoints: message results only come from conversations the searcher
      can open (company channels stay company-wide, team conversations are
      restricted to members + managers/admins, and DM/group chats surface only
      to their participants); shared files respect `canAccess`, tasks respect
      the employee/team scope, and people/teams/channels/meetings are
      company-scoped
- [x] **API** — `GET /api/search/global` (grouped overview) and
      `GET /api/search/global/:scope` (paginated per-scope results), built on
      `GlobalSearchRepository` behind `SearchService` / `SearchController`
- [x] **Tests** — `server/test/search.service.test.ts` (overview fan-out to all
      seven scopes with the viewer context, per-scope routing and pagination,
      quick-search delegation)

### UI (SRS §18)
- [x] Login / Register / Forgot Password / Reset Password screens
- [x] Dashboard with sidebar (channels, teams, people), members panel,
      presence dots, typing indicators, notifications bell
- [x] Profile page, Admin dashboard (users / teams / channels tabs)
- [x] Responsive layout (desktop / tablet / mobile breakpoints)
- [x] **Unified icon system** — one shared SVG icon set (50+ icons) replaces the
      scattered emoji/unicode glyphs (☰ ⌕ ♧ ⌄ ☀ ☾ 📞 📹 …) across the app;
      stroke weight is configurable and icons can carry an accessible title

---

## ⚠️ Known Gaps / TODO

- [ ] **Email delivery** — password reset currently returns the reset token
      in the API response (shown to the user in dev mode). Wire an SMTP
      provider (see `EMAIL_*` in `.env.example`) for production.
- [ ] **Server tests** — no automated test suite yet (SRS §24). Client has
      only the default smoke test.
- [ ] **Reconnection queue persistence** — offline WS messages are queued
      in memory only; they are dropped on page reload.
- [ ] **Token blacklist** — logout marks `user_sessions` rows as logged out
      (they are kept as login history), but JWT revocation for
      issued-but-unexpired tokens is not enforced.
- [ ] **Advanced features** — threads, video/voice, push notifications, AI
      assistant (deferred per SRS §26).

---

## 🚀 Quick Start

```bash
npm run install:server
npm run install:client
cp server/.env.example server/.env   # set DB_PASSWORD etc.
npm run server                       # API + WebSocket on :8080
npm run client                       # React app on :3000
```

Database:

```bash
cd server
npm run db:init    # creates DB + tables (+ auto-applies migrations)
npm run db:seed    # demo data (idempotent)
```

Demo accounts (password for all: `kneachat168`):

- `admin@kneachat.com` — admin
- `dara@kneachat.com` — manager
- `maya@kneachat.com` — employee
- `sopheap@kneachat.com`, `nimol@kneachat.com`, `lina@kneachat.com`

---

## 📦 Deliverables

- **Server (Node.js + Express + MySQL + ws):** models, services, 8 route
  modules (50+ endpoints incl. uploads + pinning), 4 WebSocket handlers,
  JWT/bcrypt auth, RBAC, rate limiting, schema + migrations + seed.
- **Client (React + TypeScript + Tailwind):** auth flows, chat dashboard
  (real-time), profile, admin dashboard, search, mentions, attachments,
  replies, pinning, teams/channels/group-chat management.
- **Docs:** this file, README, QUICK_START, DEVELOPMENT, DELIVERY_SUMMARY.

---

**Status: ✅ MVP complete — ready for testing, security review, and deployment.**
