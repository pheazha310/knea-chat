# KneaChat

Workplace communication and collaboration platform built with a React + TypeScript + Tailwind client and a Node.js + Express + MySQL server. Real-time events use native WebSockets, and protected access uses JWT with bcrypt password hashing.

## Tech stack

| Layer                    | Choice                                                                    |
| ------------------------ | ------------------------------------------------------------------------- |
| Development environment  | **NVM** — Node.js version management (`.nvmrc` pins Node 24)               |
| Frontend                 | **React 19** + **TypeScript** + **Tailwind CSS** — feature-based client architecture with entity stores |
| Backend                  | **MVC** — Node.js + Express                                               |
| State management         | **Zustand** stores in `client/src/entities/<feature>/model/` and `client/src/app/stores/`                                  |
| Database                 | **MySQL** (via `mysql2` connection pool)                                   |
| Real-time                | **Native WebSocket** (`ws` package — no Socket.IO)                         |

## Project structure

```text
kneachat/
├── client/                         # React + TypeScript + Tailwind — feature-based architecture
│   └── src/
│       ├── app/                    # Application shell (router, providers, stores barrel)
│       │   ├── App.tsx             # Root component + route guards
│       │   ├── routes.ts           # Route definitions + role guards
│       │   ├── providers/          # ThemeProvider, ToastProvider
│       │   └── stores/             # Zustand stores barrel + wsListeners bridge
│       ├── entities/               # Domain modules (types + Zustand stores per feature)
│       │   ├── auth/               # Auth types + authStore
│       │   ├── conversation/       # Conversation types + chatStore (messages, typing, etc.)
│       │   ├── user/               # User types + userStore
│       │   ├── notification/       # Notification types + notificationStore
│       │   ├── company/            # Company/team/department types + companyStore
│       │   ├── announcement/       # Announcement types + announcementStore
│       │   ├── task/               # Task types + taskStore
│       │   ├── meeting/            # Meeting types + meetingStore
│       │   ├── attendance/         # Attendance types + attendanceStore
│       │   ├── file/               # Shared file types + sharedFileStore
│       │   └── ...                 # omni, search, system-setting, etc.
│       ├── features/               # Feature UI components (organized by domain)
│       │   ├── chat/               # MessageList, MessageComposer, ConversationList, ThreadPanel
│       │   ├── channels/           # ChannelsView, CreateChannelModal
│       │   ├── teams/              # TeamsView, CreateTeamModal, TeamModal
│       │   ├── announcements/      # AnnouncementsView
│       │   ├── notifications/      # NotifsView, NotificationMessageModal, reply/reaction actions
│       │   ├── settings/           # SettingsView
│       │   ├── files/              # SharedFilesView, FilePreview, FileShareModal, FileVersionHistory
│       │   ├── attendance/         # AttendanceView, ManagerAttendanceView, ClockControls, etc.
│       │   ├── meetings/           # MeetingsView, CreateMeetingModal, MeetingNoteModal
│       │   ├── tasks/              # TasksView, TaskDetailModal
│       │   ├── bookmarks/          # BookmarksView
│       │   ├── search/             # SearchModal, SearchView
│       │   ├── omni-inbox/         # OmniInboxView
│       │   └── calls/              # CallModal, IncomingCallModal, CallChatPanel
│       ├── pages/                  # Page-level layouts (role-based)
│       │   ├── auth/ui/               # LoginPage, ForgotPasswordPage, ResetPasswordPage
│       │   ├── dashboard/ui/          # DashboardPage (layout shell + sidebar navigation)
│       │   ├── admin/ui/              # AdminPage
│       │   ├── super-admin/ui/        # SuperAdminPage
│       │   ├── manager/ui/            # ManagerPage
│       │   └── profile/ui/            # ProfilePage
│       ├── shared/                 # Cross-cutting UI and utilities
│       │   ├── ui/                 # Avatar, Icon, Modal, Skeleton, EmptyState, ReactionBar, etc.
│       │   ├── lib/                # api.ts (Axios client), websocket.ts (WebSocket singleton), webrtc.ts
│       │   └── stores/             # callStore (cross-feature call state)
│       └── widgets/                # Reusable composite widgets
│           └── sidebar/            # Sidebar navigation component
├── server/                          # Node.js + Express — MVC architecture
│   ├── src/
│   │   ├── server.ts               # HTTP + WS server bootstrap
│   │   ├── app.ts                  # Express app (middleware, routes)
│   │   ├── container.ts            # Composition root (DI wiring)
│   │   ├── database/               # MySQL connection pool
│   │   ├── cache/                  # Redis client with memory fallback
│   │   ├── middleware/             # Authentication and error handling
│   │   ├── types/                  # Server domain and Express types
│   │   ├── utils/                  # Shared server helpers
│   │   ├── repositories/           # MySQL data access (35 repositories)
│   │   ├── services/               # Business logic (29 services)
│   │   ├── controllers/            # HTTP request handlers (27 controllers)
│   │   ├── routes/                 # Express route definitions (28 route files)
│   │   ├── websocket/              # Real-time event handlers
│   │   ├── factories/              # Factory helpers
│   │   └── integrations/           # Omni-channel adapters (Telegram, website, email)
│   ├── database/migrations/        # MySQL schema migrations
│   ├── test/                        # Node test-runner unit/integration tests
│   ├── e2e/                         # End-to-end scripts
│   └── scripts/                     # Database, demo, and local-service scripts
└── docs/                            # Setup, implementation status, and delivery notes
```

## Architecture

KneaChat is split into two layers with explicit architectural patterns:

### Frontend — Feature-based architecture with entity stores

The client is organized by **feature domain**. Each feature owns its types, state, and UI in a single cohesive unit.

| Layer | Location | Responsibility |
|-------|----------|----------------|
| **Entity store** | `client/src/entities/<feature>/model/` | TypeScript interfaces + Zustand store per domain (e.g. `authStore.ts`, `chatStore.ts`) |
| **Feature layer** | `client/src/features/<feature>/` | Optional ViewModel in `model/` (e.g. `useChatViewModel.ts`) + React UI components in `ui/` |
| **Pages** | `client/src/pages/<role>/ui/` | Role-based page layouts that compose feature views |
| **Shared** | `client/src/shared/` | Cross-cutting UI (`ui/`), infrastructure (`lib/`), and cross-feature stores (`stores/`) |
| **Widgets** | `client/src/widgets/` | Reusable composite widgets (e.g. `sidebar/`) |
| **App shell** | `client/src/app/` | Router, route guards, providers (Theme, Toast), stores barrel + WebSocket→Zustand bridge |

**Data flow:**

```
View (pages/features/shared)
  → optional ViewModel (features/*/model)
    → Entity Store (entities/*/model)
      → Infrastructure (shared/lib/api.ts, shared/lib/websocket.ts)
        → REST / WebSocket
```

Shared application state lives in Zustand stores under `client/src/entities/<feature>/model/`. WebSocket events update those stores directly via `app/stores/wsListeners.ts`, so the UI re-renders automatically. `DashboardPage` is the main layout shell; individual feature views are composed inside it.

### Backend — MVC (Model–View–Controller)

| Layer | Location | Responsibility |
|-------|----------|----------------|
| **Controller** | `server/src/controllers` | HTTP request handlers — parse the request, call a service, build the response |
| **View** | `server/src/routes` + JSON | Thin URL → controller wiring plus auth middleware; the JSON payloads are the view |
| **Service** | `server/src/services` | Business rules and cross-entity orchestration |
| **Repository** | `server/src/repositories` | MySQL queries and persistence |

Request flow: **Route → Controller → Service → Repository → MySQL**. Route files only map endpoints to controller methods; all handler logic lives in `src/controllers/`.

## Roles & permissions

KneaChat uses a hierarchical role model — each role inherits the permissions
of every role below it:

| Role | Key | Description |
| --- | --- | --- |
| Super Admin | `super_admin` | Controls the entire KneaChat platform (organizations, admins, settings) |
| Company Admin | `admin` | Manages a company/workspace (users, roles, teams, channels) |
| Manager | `manager` | Manages assigned teams and their channels/members |
| Employee | `employee` | Regular workplace user (chat, join teams/channels, own profile) |

Enforcement lives in `server/src/utils/roles.ts` (hierarchy + assign rules),
route/service middleware on the server, and route guards in the client.
See `docs/IMPLEMENTATION_STATUS.md` → Role Matrix for the full breakdown.

## Run locally

Requires **Node.js 24** — install it with NVM and the repo's pinned version:

```bash
nvm install           # reads .nvmrc
nvm use               # switches to the pinned Node version
node --version        # should print v24.x
```

Then install dependencies:

```bash
npm run install:server
npm run install:client
```

Create the server environment file:

```bash
cp server/.env.example server/.env
```

Edit `server/.env` with your MySQL credentials and JWT secret. Start the backend:

```bash
npm run server
```

In another terminal, start the frontend:

```bash
npm run client
```

Client: `http://localhost:3000`  
API and WebSocket: `http://localhost:8080`

## Database

From the `server/` directory, run migrations and seed data:

```bash
cd server
npm run db:setup
npm run db:seed
```

Or from the project root:

```bash
npm --prefix server run db:setup
npm --prefix server run db:seed
```

Reset and seed with demo data:

```bash
cd server
npm run db:init
npm run seed:demo
```

## Testing

```bash
npm test                          # client tests
cd server && npm test             # backend unit/integration tests
cd server && npm run test:e2e     # specific e2e suite
cd server && npm run test:e2e:permissions
cd server && npm run test:e2e:attendance
cd server && npm run test:e2e:files
cd server && npm run test:e2e:tasks
cd server && npm run test:e2e:sessions
```

## Scripts

```bash
cd server && npm run daemon          # run backend as a daemon
cd server && npm run daemon:stop     # stop daemon
cd server && npm run daemon:restart  # restart daemon
cd server && npm run daemon:status   # check daemon status
cd server && npm run lint            # lint server source
cd server && npm run format          # format server source
npm run build                       # build client for production
```

## Telegram omni-channel inbox

KneaChat can act as a support inbox for Telegram: customer messages arrive via
webhook, appear in the Messages view, and agents reply from KneaChat (the
composer routes replies through `POST /api/telegram/messages`). See
[`docs/TELEGRAM_INTEGRATION.md`](docs/TELEGRAM_INTEGRATION.md) for setup,
webhook registration, ngrok local testing, and the API reference. Requires
migration `024_telegram_omni_channel.sql` and the `TELEGRAM_*` environment
variables.

## Email omni-channel inbox

KneaChat can also act as a support inbox for Email: customer messages arrive via
webhook, appear in the Messages view, and agents reply from KneaChat (the
composer routes replies through `POST /api/email/messages`). Requires
migration `029_email_omni_channel.sql` and the `EMAIL_*` environment
variables. See
[`docs/EMAIL_INTEGRATION.md`](docs/EMAIL_INTEGRATION.md) for provider setup
(Mailgun, SendGrid, SES, Postmark, or generic HMAC), env configuration, local
testing with ngrok, and the API reference. Verified by
`npm run test:e2e:email` from the `server/` directory.

## Project hygiene

- Keep source code in `client/src/` and `server/src/`; place database changes in
  `server/database/migrations/`, tests in `server/test/`, and one-off developer
  scripts in `server/scripts/`.
- Do not commit generated folders (`client/build/`, `server/dist/`) or local
  dependencies. They are rebuilt with the package scripts.
- Treat `docs/IMPLEMENTATION_STATUS.md` as the current delivery status; older
  delivery and checklist documents are historical project notes.
- The Git repository currently lives in `client/.git`. Initialise or move it to
  the project root before committing server or documentation changes.
