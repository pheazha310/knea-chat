# KneaChat API Server

Express, MySQL, JWT, bcrypt, and WebSocket server for KneaChat.

## Commands

```bash
npm install
cp .env.example .env
npm run dev
```

The REST API and WebSocket server run on port `8080` by default.

The MySQL schema is in `database/migrations/001_initial_schema.sql`.

## Running as a supervised background service

The server can be run as a detached, self-healing background service that
auto-restarts on crashes and rotates its logs:

```bash
npm run daemon          # start (detached, supervises node src/server.js)
npm run daemon:status   # show supervisor + server state
npm run daemon:stop     # stop the supervisor and the server
npm run daemon:restart  # stop, then start fresh
```

The supervisor (`scripts/kneachat-daemon.py`) restarts the server whenever it
exits unexpectedly (with exponential backoff to avoid crash loops), rotates the
log once it grows past 10 MiB (keeping 3 backups, `log.1`, `log.2`, `log.3`),
and writes the server PID to `/tmp/kneachat-server.pid`. It refuses to start if
another supervisor is already running — use `npm run daemon:restart` (or
`--force`) to replace it.
