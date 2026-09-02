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

## Run locally

Requires **Node.js 24** (or newer) — install it with NVM and the repo's pinned version:

```bash
nvm install           # reads .nvmrc
nvm use               # switches to the pinned Node version
node --version        # should print v24.x
```

Then start the apps:

```bash
npm run install:server
npm run install:client
cp server/.env.example server/.env
npm run server
```

In another terminal:

```bash
npm run client
```

Client: `http://localhost:3000`  
API and WebSocket: `http://localhost:8080`

# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
