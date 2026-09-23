# KneaChat — Delivery Summary

> **Project:** KneaChat — Real-time workplace communication platform  
> **Stack:** React 19 (client) + Express + WebSocket (server) + MySQL + Redis  
> **Node Version:** 24  
> **Last Updated:** September 2026

---

## 📦 What Has Been Delivered

A **production-ready full-stack workplace communication platform** with:

✅ **Express.js REST API** with 100+ endpoints across 28 route files  
✅ **WebSocket Real-Time Server** for instant messaging, presence, typing, calls  
✅ **JWT Authentication** with role-based authorization + session management  
✅ **MySQL Database** with 40+ tables, migrations, and seed data  
✅ **React Client** with feature-based architecture, entity stores, and Zustand  
✅ **Omni-Channel Inbox** — Telegram + Website + Email via adapter pattern  
✅ **Attendance System** — clock in/out, breaks, leave, overtime, holidays, schedules  
✅ **Meetings** — create, manage, notes, reminders, attendees, ICS export  
✅ **Tasks** — Kanban board, comments, attachments, notifications  
✅ **Announcements** — targeting, pinning, scheduling, read confirmation  
✅ **File Sharing** — company/team files, version history, permissions, embedding  
✅ **Search** — quick search + global search across 7 scopes  
✅ **Comprehensive Documentation** — SRS, API reference, workflow guides, integration docs  

---

## 📊 Project Structure

```
chat_websocket/
├── client/                         # React + TypeScript + Tailwind — feature-based architecture
│   ├── package.json
│   ├── tsconfig.json
│   ├── public/
│   └── src/
│       ├── app/                    # Application shell (router, providers, stores barrel)
│       │   ├── App.tsx             # Root component + route guards
│       │   ├── routes.ts           # Route definitions + role guards
│       │   ├── providers/          # ThemeProvider, ToastProvider
│       │   └── stores/             # Zustand stores barrel + wsListeners bridge
│       ├── entities/               # Domain modules (types + Zustand stores per feature)
│       │   ├── auth/               # Auth types + authStore
│       │   ├── conversation/       # Conversation types + chatStore
│       │   ├── user/               # User types + userStore
│       │   ├── notification/       # Notification types + notificationStore
│       │   ├── company/            # Company/team/department types + companyStore
│       │   ├── announcement/       # Announcement types + announcementStore
│       │   ├── task/               # Task types + taskStore
│       │   ├── meeting/            # Meeting types + meetingStore
│       │   ├── attendance/         # Attendance types + attendanceStore
│       │   ├── file/               # Shared file types + sharedFileStore
│       │   └── ...                 # omni, search, system-setting, subscription, etc.
│       ├── features/               # Feature UI components (organized by domain)
│       │   ├── chat/               # MessageList, MessageComposer, ConversationList
│       │   ├── channels/           # ChannelsView, CreateChannelModal
│       │   ├── teams/              # TeamsView, CreateTeamModal, TeamModal
│       │   ├── announcements/      # AnnouncementsView
│       │   ├── notifications/      # NotifsView, NotificationMessageModal
│       │   ├── settings/           # SettingsView
│       │   ├── files/              # SharedFilesView, FilePreview, FileShareModal
│       │   ├── attendance/         # AttendanceView, ManagerAttendanceView
│       │   ├── meetings/           # MeetingsView, CreateMeetingModal
│       │   ├── tasks/              # TasksView, TaskDetailModal
│       │   ├── bookmarks/          # BookmarksView
│       │   ├── search/             # SearchModal, SearchView
│       │   ├── omni-inbox/         # OmniInboxView
│       │   └── calls/              # CallModal, IncomingCallModal, CallChatPanel
│       ├── pages/                  # Page-level layouts (role-based)
│       │   ├── auth/ui/               # LoginPage, ForgotPasswordPage, ResetPasswordPage
│       │   ├── dashboard/ui/          # DashboardPage (layout shell + sidebar)
│       │   ├── admin/ui/              # AdminPage
│       │   ├── super-admin/ui/        # SuperAdminPage
│       │   ├── manager/ui/            # ManagerPage
│       │   └── profile/ui/            # ProfilePage
│       ├── shared/                 # Cross-cutting UI and utilities
│       │   ├── ui/                 # Avatar, Icon, Modal, Skeleton, EmptyState, etc.
│       │   ├── lib/                # api.ts, websocket.ts, webrtc.ts
│       │   └── stores/             # callStore
│       └── widgets/                # Reusable composite widgets
│           └── sidebar/            # Sidebar navigation
├── server/                         # Node.js + Express — MVC architecture
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env                        # Runtime secrets
│   ├── .env.example
│   ├── e2e/                        # End-to-end test scripts
│   ├── test/                       # Unit/integration tests
│   ├── scripts/                    # Database, demo, and local-service scripts
│   └── src/
│       ├── server.ts               # HTTP + WS server bootstrap
│       ├── app.ts                  # Express app (middleware, routes)
│       ├── container.ts            # Composition root (DI wiring)
│       ├── database/               # MySQL connection pool
│       ├── cache/                  # Redis client with memory fallback
│       ├── middleware/             # Authentication and error handling
│       ├── types/                  # Server domain and Express types
│       ├── utils/                  # Shared server helpers
│       ├── repositories/           # MySQL data access (35 repositories)
│       ├── services/               # Business logic (29 services)
│       ├── controllers/            # HTTP request handlers (27 controllers)
│       ├── routes/                 # Express route definitions (28 route files)
│       ├── websocket/              # Real-time event handlers
│       ├── factories/              # Factory helpers
│       └── integrations/           # Omni-channel adapters (Telegram, website, email)
└── docs/                           # Setup, implementation status, and delivery notes
```

---

## 🚀 Run Locally

Requires **Node.js 24** (`.nvmrc`), MySQL 8.0+, and optionally Redis.

```bash
# Install dependencies
npm run install:server
npm run install:client

# Configure environment
cp server/.env.example server/.env
# Edit server/.env with your MySQL credentials and JWT secret

# Initialize database
cd server
npm run db:init
npm run db:seed

# Run development
npm run dev
```

Client: `http://localhost:3000`  
API and WebSocket: `http://localhost:8080`

---

## 📊 Architecture

### Frontend — Feature-based architecture with entity stores

| Layer | Location | Responsibility |
|-------|----------|----------------|
| **Model** | `client/src/entities/<feature>/model/` | TypeScript interfaces + Zustand store per domain |
| **ViewModel** | `client/src/features/<feature>/model/` | Feature-level ViewModels that compose entity stores |
| **View** | `client/src/pages/`, `client/src/features/<feature>/ui/`, `client/src/shared/ui/` | Page layouts, feature screens, presentational components |
| **Infrastructure** | `client/src/shared/lib/` | `api.ts` (Axios client), `websocket.ts` (WebSocket singleton) |
| **Application shell** | `client/src/app/` | Router, route guards, providers, stores barrel |

**Data flow:**

```
View → ViewModel → Entity Store → Infrastructure → REST / WebSocket
```

### Backend — MVC (Model–View–Controller)

| Layer | Location | Responsibility |
|-------|----------|----------------|
| **Controller** | `server/src/controllers` | HTTP request handlers |
| **Service** | `server/src/services` | Business rules and orchestration |
| **Repository** | `server/src/repositories` | MySQL queries and persistence |

Request flow: **Route → Controller → Service → Repository → MySQL**

---

## 👥 Roles & Permissions

| Role | Key | Description |
| --- | --- | --- |
| Super Admin | `super_admin` | Controls the entire platform (organizations, admins, settings) |
| Company Admin | `admin` | Manages a company/workspace (users, roles, teams, channels) |
| Manager | `manager` | Manages assigned teams and their channels/members |
| Employee | `employee` | Regular workplace user (chat, join teams/channels, own profile) |

Enforcement lives in `server/src/utils/roles.ts` (hierarchy + assign rules), route/service middleware on the server, and route guards in the client.

---

## 📡 Omni-Channel Inbox

KneaChat can act as a support inbox for **Telegram**, **Website**, and **Email**: customer messages arrive via webhook, appear in the Messages view, and agents reply from KneaChat.

- **Telegram:** See [`docs/TELEGRAM_INTEGRATION.md`](docs/TELEGRAM_INTEGRATION.md)
- **Website:** See [`docs/PROJECT_STRUCTURE_AND_WORKFLOW.md`](docs/PROJECT_STRUCTURE_AND_WORKFLOW.md) §7.6
- **Email:** See [`docs/EMAIL_INTEGRATION.md`](docs/EMAIL_INTEGRATION.md)

---

## 🧪 Testing

```bash
npm test                          # client tests
npm run server -- test            # backend unit/integration tests
npm run server -- test:e2e        # specific e2e suite
npm run server -- test:e2e:permissions
npm run server -- test:e2e:attendance
npm run server -- test:e2e:files
npm run server -- test:e2e:tasks
npm run server -- test:e2e:sessions
npm run server -- test:e2e:email
```

---

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| `README.md` | Project overview, architecture, run commands |
| `docs/PROJECT_STRUCTURE_AND_WORKFLOW.md` | Full architecture, data flow, workflows |
| `docs/BACKEND_WORKFLOW.md` | Backend request lifecycles, WebSocket routing |
| `docs/API_REFERENCE.md` | Complete REST API reference |
| `docs/DEVELOPMENT.md` | Backend development guide |
| `docs/QUICK_START.md` | 5-minute backend setup |
| `docs/SRS.md` | Software Requirements Specification |
| `docs/PROCESS_FLOWS.md` | Detailed step-by-step feature flows |
| `docs/EMAIL_INTEGRATION.md` | Email omni-channel setup and API reference |
| `docs/TELEGRAM_INTEGRATION.md` | Telegram omni-channel setup and API reference |
| `docs/IMPLEMENTATION_STATUS.md` | Current delivery status and role matrix |
| `docs/STRUCTURE_IMPROVEMENT_PLAN.md` | Prioritized refactoring plan |

---

## 📝 Project Hygiene

- Keep source code in `client/src/` and `server/src/`; place database changes in `server/database/migrations/`, tests in `server/test/`, and one-off developer scripts in `server/scripts/`.
- Do not commit generated folders (`client/build/`, `server/dist/`) or local dependencies.
- Treat `docs/IMPLEMENTATION_STATUS.md` as the current delivery status; older delivery and checklist documents are historical project notes.

---

**Status:** ✅ MVP complete — ready for testing, security review, and deployment.
