# KneaChat Client

React + TypeScript + Tailwind client for KneaChat. Real-time events use native WebSockets, and protected access uses JWT with bcrypt password hashing.

## Tech stack

| Layer                    | Choice                                                                    |
| ------------------------ | ------------------------------------------------------------------------- |
| Development environment  | **NVM** — Node.js version management (`.nvmrc` pins Node 24)               |
| Frontend                 | **React 19** + **TypeScript** + **Tailwind CSS**                           |
| State management         | **Zustand** stores in `client/src/entities/<feature>/model/`               |
| HTTP client              | **Axios** (`client/src/shared/lib/api.ts`)                                 |
| Real-time                | **Native WebSocket** (`ws` package — no Socket.IO)                         |
| Routing                  | **React Router DOM**                                                      |

## Project structure

```text
client/
├── package.json
├── tsconfig.json
├── public/
│   └── robots.txt
└── src/
    ├── index.tsx               # React entry
    ├── App.tsx                 # Router + auth guards
    ├── app/                    # Application shell
    │   ├── App.tsx             # Root component + route guards
    │   ├── routes.ts           # Route definitions + role guards
    │   ├── providers/          # ThemeProvider, ToastProvider
    │   └── stores/             # Zustand stores barrel + wsListeners bridge
    ├── entities/               # Domain modules (types + Zustand stores per feature)
    │   ├── auth/               # Auth types + authStore
    │   ├── conversation/       # Conversation types + chatStore (messages, typing, etc.)
    │   ├── user/               # User types + userStore
    │   ├── notification/       # Notification types + notificationStore
    │   ├── company/            # Company/team/department types + companyStore
    │   ├── announcement/       # Announcement types + announcementStore
    │   ├── task/               # Task types + taskStore
    │   ├── meeting/            # Meeting types + meetingStore
    │   ├── attendance/         # Attendance types + attendanceStore
    │   ├── file/               # Shared file types + sharedFileStore
    │   └── ...                 # omni, search, system-setting, subscription, etc.
    ├── features/               # Feature UI components (organized by domain)
    │   ├── chat/               # MessageList, MessageComposer, ConversationList, ThreadPanel
    │   ├── channels/           # ChannelsView, CreateChannelModal
    │   ├── teams/              # TeamsView, CreateTeamModal, TeamModal
    │   ├── announcements/      # AnnouncementsView
    │   ├── notifications/      # NotifsView, NotificationMessageModal, reply/reaction actions
    │   ├── settings/           # SettingsView
    │   ├── files/              # SharedFilesView, FilePreview, FileShareModal, FileVersionHistory
    │   ├── attendance/         # AttendanceView, ManagerAttendanceView, ClockControls, etc.
    │   ├── meetings/           # MeetingsView, CreateMeetingModal, MeetingNoteModal
    │   ├── tasks/              # TasksView, TaskDetailModal
    │   ├── bookmarks/          # BookmarksView
    │   ├── search/             # SearchModal, SearchView
    │   ├── omni-inbox/         # OmniInboxView
    │   └── calls/              # CallModal, IncomingCallModal, CallChatPanel
    ├── pages/                  # Page-level layouts (role-based)
    │   ├── auth/ui/               # LoginPage, ForgotPasswordPage, ResetPasswordPage
    │   ├── dashboard/ui/          # DashboardPage (layout shell + sidebar navigation)
    │   ├── admin/ui/              # AdminPage
    │   ├── super-admin/ui/        # SuperAdminPage
    │   ├── manager/ui/            # ManagerPage
    │   └── profile/ui/            # ProfilePage
    ├── shared/                 # Cross-cutting UI and utilities
    │   ├── ui/                 # Avatar, Icon, Modal, Skeleton, EmptyState, ReactionBar, etc.
    │   ├── lib/                # api.ts (Axios client), websocket.ts (WebSocket singleton), webrtc.ts
    │   └── stores/             # callStore (cross-feature call state)
    └── widgets/                # Reusable composite widgets
        └── sidebar/            # Sidebar navigation component
```

## Architecture

KneaChat client is organized by **feature domain**. Each feature owns its types, state management, and UI in a single cohesive unit.

| Layer | Location | Responsibility |
|-------|----------|----------------|
| **Entity store** | `client/src/entities/<feature>/model/` | TypeScript interfaces + Zustand store per domain (e.g. `authStore.ts`, `chatStore.ts`) |
| **Feature layer** | `client/src/features/<feature>/` | React UI components in `ui/`; optional ViewModel in `model/` (currently only chat has `useChatViewModel.ts`) |
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

## Run locally

Requires **Node.js 24** — install it with NVM and the repo's pinned version:

```bash
nvm install           # reads .nvmrc
nvm use               # switches to the pinned Node version
node --version        # should print v24.x
```

Install dependencies:

```bash
npm run install:client
```

Start the client:

```bash
npm run client
```

Client runs on `http://localhost:3000`.

## Available scripts

| Script | Purpose |
|--------|---------|
| `npm run client` | Run React dev server (port 3000) |
| `npm run client -- build` | Build client for production |
| `npm test` | Run Jest + React Testing Library tests |
| `npm run lint` | Lint client source |
| `npm run format` | Format client source |

## WebSocket client

**File:** `client/src/shared/lib/websocket.ts`

**Class:** `WebSocketService` (singleton)

- Connection management (single socket, reuse on reconnect)
- JWT token authentication (query parameter)
- Exponential backoff reconnection (max 8 attempts, base 1s)
- Heartbeat (ping/pong every 15s, 5s timeout)
- Event queuing (messages queued while disconnected)
- Typed event map (`WsEventMap`) for type safety
- Listener management (on/off/emit)

## WebSocket → Zustand Bridge

**File:** `client/src/app/stores/wsListeners.ts`

Subscribes once from `App.tsx`. Dispatches events to Zustand stores:

```
WebSocket Server → WebSocket Client → Zustand Stores → React Components → UI

Events dispatched:
- receive_message → chatStore
- message_sent_ack → chatStore
- message_updated/deleted → chatStore
- typing_start/stop → chatStore
- user_online/offline → userStore
- incoming_call → callStore
- notification → notificationStore
- announcement_created/updated/deleted → announcementStore
- task_reacted/unreacted → taskStore
- shared_file_created/updated/deleted → sharedFileStore
- meeting_created/updated/cancelled → meetingStore
- attendance:clocked_in/out → attendanceStore
- omni_assignment_changed → chatStore (refresh conversations)
- workspace_changed → chatStore/companyStore (refresh teams/channels)
```

## See also

- Root `README.md` — full project documentation, architecture, run commands
- `docs/PROJECT_STRUCTURE_AND_WORKFLOW.md` — client-side architecture, data flow, entity stores
- `docs/BACKEND_WORKFLOW.md` — backend request lifecycles and WebSocket event routing
- `docs/API_REFERENCE.md` — REST API endpoints
- `docs/EMAIL_INTEGRATION.md` — email omni-channel inbox setup
- `docs/TELEGRAM_INTEGRATION.md` — Telegram omni-channel inbox setup
