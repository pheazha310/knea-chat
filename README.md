# KneaChat

Workplace communication and collaboration platform built with a React + TypeScript + Tailwind client and a Node.js + Express + MySQL server. Real-time events use native WebSockets, and protected access uses JWT with bcrypt password hashing.

## Tech stack

| Layer                    | Choice                                                                    |
| ------------------------ | ------------------------------------------------------------------------- |
| Development environment  | **NVM** — Node.js version management (`.nvmrc` pins Node 24)               |
| Frontend                 | **MVVM** — React + TypeScript + Tailwind CSS                              |
| Backend                  | **MVC** — Node.js + Express                                               |
| State management         | **Zustand** stores in `client/src/store/`                                  |
| Database                 | **MySQL** (via `mysql2` connection pool)                                   |
| Real-time                | **Native WebSocket** (`ws` package — no Socket.IO)                         |

## Project structure

```text
kneachat/
├── client/                         # React + TypeScript + Tailwind — MVVM architecture
│   └── src/
│       ├── models/                  # Domain entities and API payload types
│       ├── viewmodels/              # ViewModel layer: selector hooks binding views to stores
│       ├── views/                   # View layer: page-level screens (Login, Dashboard, …)
│       ├── components/              # Reusable UI, grouped by feature (chat, modals, layout, …)
│       ├── store/                   # Zustand stores (auth, chat, user, notification, company) + WS wiring
│       ├── contexts/                # UI-wide contexts (theme, toast)
│       ├── services/                # HTTP client + WebSocket client (data-access infrastructure)
│       └── utils/                   # Shared client helpers
├── server/                          # Node.js + Express — MVC architecture
│   ├── src/
│   │   ├── controllers/             # Controllers: HTTP request handlers
│   │   ├── routes/                  # URL → controller wiring + auth middleware
│   │   ├── services/                # Business logic
│   │   ├── repositories/            # MySQL data access
│   │   ├── middleware/              # Authentication and error handling
│   │   ├── database/                # MySQL connection pool
│   │   ├── websocket/               # Real-time event handlers
│   │   ├── types/                   # Server domain and Express types
│   │   └── utils/                   # Shared server helpers
│   ├── database/migrations/         # MySQL schema migrations
│   ├── test/                        # Node test-runner unit/integration tests
│   ├── e2e/                         # End-to-end scripts
│   └── scripts/                     # Database, demo, and local-service scripts
└── docs/                            # Setup, implementation status, and delivery notes
```

## Architecture

KneaChat is split into two layers with explicit architectural patterns:

### Frontend — MVVM (Model–View–ViewModel)

| Layer        | Location           | Responsibility                                          |
| ------------ | ------------------ | ------------------------------------------------------- |
| **Model**    | `client/src/models`   | Domain entities and API payload types |
| **View**     | `client/src/views`, `client/src/components` | Rendering only — screens and presentational components bind to a ViewModel and never call the API directly |
| **ViewModel** | `client/src/viewmodels`, `client/src/store`, `client/src/contexts` | View state + commands — `useChatViewModel` selects from Zustand stores; `ThemeContext` / `ToastContext` handle UI-wide concerns |

Data flows **View → ViewModel/store → services → REST/WebSocket**. Shared application state lives in Zustand stores (`client/src/store/`); WebSocket events update them directly via `store/wsListeners.ts`, so the UI re-renders automatically. `Dashboard` (the view) just renders what the ViewModel selects.

### Backend — MVC (Model–View–Controller)

| Layer          | Location                     | Responsibility                                  |
| -------------- | ---------------------------- | ----------------------------------------------- |
| **Controller** | `server/src/controllers`     | HTTP request handlers — parse the request, call a service, build the response |
| **View**       | `server/src/routes` + JSON   | Thin URL → controller wiring plus auth middleware; the JSON payloads are the view |
| **Service**    | `server/src/services`     | Business rules and cross-entity orchestration |
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

Run migrations and seed data:

```bash
npm run server -- db:setup
npm run server -- db:seed
```

Reset and seed with demo data:

```bash
npm run server -- db:init
npm run server -- seed:demo
```

## Testing

```bash
npm test                          # client tests
npm run server -- test            # backend unit/integration tests
npm run server -- test:e2e        # specific e2e suite
npm run server -- test:e2e:permissions
npm run server -- test:e2e:attendance
npm run server -- test:e2e:files
npm run server -- test:e2e:tasks
npm run server -- test:e2e:sessions
```

## Scripts

```bash
npm run server -- daemon          # run backend as a daemon
npm run server -- daemon:stop     # stop daemon
npm run server -- daemon:restart  # restart daemon
npm run server -- daemon:status   # check daemon status
npm run server -- lint            # lint server source
npm run server -- format          # format server source
npm run client -- build           # build client for production
```

## Telegram omni-channel inbox

KneaChat can act as a support inbox for Telegram: customer messages arrive via
webhook, appear in the Messages view, and agents reply from KneaChat (the
composer routes replies through `POST /api/telegram/messages`). See
[`docs/TELEGRAM_INTEGRATION.md`](docs/TELEGRAM_INTEGRATION.md) for setup,
webhook registration, ngrok local testing, and the API reference. Requires
migration `024_telegram_omni_channel.sql` and the `TELEGRAM_*` environment
variables.

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
