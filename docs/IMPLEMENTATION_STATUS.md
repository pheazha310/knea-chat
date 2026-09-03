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
- [x] **Attachments** — file upload with type (extension + MIME) and size
      validation, attachment chips, static file serving
- [x] **Pinning** — pin/unpin messages with real-time broadcast

### Workplace (US-11..US-14, FR-05..FR-07)
- [x] Teams — create, list, view members, add/remove members, team channels,
      shared team conversations (open from the sidebar; member changes sync
      conversation membership)
- [x] **Announcements (FR-24)** — company-wide announcements published by
      managers/admins (`/api/announcements`), dedicated sidebar view with a
      composer, real-time `announcement_*` WebSocket events, and an
      `announcement` notification for every company user (bell + Notifications)
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
- [x] Message search (with conversation context) and user search
- [x] Client search modal (⌘K) with jump-to-conversation

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
- [ ] **Token blacklist** — logout clears `user_sessions`, but JWT revocation
      for issued-but-unexpired tokens is not enforced.
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
