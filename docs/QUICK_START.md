# 🚀 KneaChat Backend — Quick Start Guide

## ⚡ 5-Minute Setup

### Step 1: Install Dependencies

```bash
cd chat_websocket
npm run install:server
npm run install:client
```

### Step 2: Configure Environment

```bash
cp server/.env.example server/.env
# Edit server/.env with your MySQL credentials
```

Required env vars: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `CORS_ORIGIN`, `PORT`

### Step 3: Create Database

```bash
mysql -u root -p
CREATE DATABASE kneachat;
EXIT;
```

### Step 4: Start Server

```bash
npm run server
```

✅ Server running on `http://localhost:8080`

In another terminal:

```bash
npm run client
```

✅ Client running on `http://localhost:3000`

---

## 📡 Test the API

### Login (Get JWT Token)

```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@kneachat.com","password":"kneachat168"}'
```

**Response:**

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": { "id": 1, "email": "admin@kneachat.com", "role": "admin" },
    "token": "eyJhbGc...",
    "expiresIn": "24h"
  }
}
```

### Test Protected Endpoint

```bash
curl http://localhost:8080/api/users \
  -H "Authorization: Bearer <your-token-here>"
```

### Health Check

```bash
curl http://localhost:8080/api/health
```

---

## 🔌 Test WebSocket

### Using wscat (CLI)

```bash
# Install wscat
npm install -g wscat

# Connect with token
wscat -c "ws://localhost:8080?token=<your-token-here>"

# Send a message
{"type":"send_message","conversationId":1,"content":"Hello!"}

# Send typing indicator
{"type":"typing_start","conversationId":1}
```

### Using Browser Console

```javascript
// In browser console
const ws = new WebSocket("ws://localhost:8080?token=<your-token>");

ws.onmessage = (event) => {
  console.log("Message from server:", event.data);
};

// Send message
ws.send(
  JSON.stringify({
    type: "send_message",
    conversationId: 1,
    content: "Hello from browser!",
  }),
);
```

---

## 📁 Project Structure

```
chat_websocket/
├── client/                         # React + TypeScript + Tailwind — feature-based architecture
│   └── src/
│       ├── app/                    # Application shell (router, providers, stores)
│       ├── entities/               # Domain modules (types + Zustand stores)
│       ├── features/               # Feature UI components
│       ├── pages/                  # Page-level layouts (role-based)
│       ├── shared/                 # Cross-cutting UI and utilities
│       └── widgets/                # Reusable composite widgets
├── server/                         # Node.js + Express — MVC architecture
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
│   │   └── integrations/           # Omni-channel adapters
│   ├── database/migrations/        # MySQL schema migrations
│   ├── test/                       # Node test-runner unit/integration tests
│   ├── e2e/                        # End-to-end scripts
│   └── scripts/                    # Database, demo, and local-service scripts
└── docs/                           # Setup, implementation status, and delivery notes
```

---

## 🔑 Key Endpoints

| Method | Endpoint                      | Auth | Purpose       |
| ------ | ----------------------------- | ---- | ------------- |
| POST   | `/api/auth/login`             | ❌   | Get JWT token |
| GET    | `/api/health`                 | ❌   | Server status |
| GET    | `/api/users`                  | ✅   | List users    |
| POST   | `/api/messages`               | ✅   | Send message  |
| GET    | `/api/conversations`          | ✅   | Get chats     |
| WS     | `ws://localhost:8080?token=X` | ✅   | Real-time     |

---

## ⚙️ Environment Variables

```bash
# Server
PORT=8080
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=kneachat

# JWT
JWT_SECRET=dev-secret-key

# Client URL (CORS)
CORS_ORIGIN=http://localhost:3000

# Optional
REDIS_URL=redis://localhost:6379
UPLOAD_DIR=uploads
```

---

## 🐛 Troubleshooting

### ❌ "Cannot connect to database"

```bash
# Check MySQL is running
mysql -u root -p
# Should connect successfully
```

### ❌ "WebSocket connection refused"

```bash
# Check server is running on port 8080
lsof -i :8080
# If port is in use, change PORT in .env
```

### ❌ "Token is invalid"

```bash
# Get a new token via login endpoint
# Update your JWT_SECRET in .env if changed
```

### ❌ "CORS error"

```bash
# Make sure CORS_ORIGIN in .env matches your client URL
CORS_ORIGIN=http://localhost:3000
```

---

## 📊 What's Implemented ✅

- [x] Express.js server setup
- [x] JWT authentication middleware
- [x] Error handling middleware
- [x] REST API (100+ endpoints, 28 route files)
- [x] WebSocket server setup
- [x] Real-time event handlers (messages, presence, typing, calls)
- [x] MySQL connection pool + migrations
- [x] Environment configuration
- [x] Response formatting utilities
- [x] Input validation utilities
- [x] Password hashing (bcrypt)
- [x] CORS configuration
- [x] Rate limiting on auth endpoints
- [x] Omni-channel adapters (Telegram, Website, Email)
- [x] Background schedulers (reminders, meetings, tasks, announcements)

---

## 📋 What's Next 📝

- [ ] Expand server unit test coverage
- [ ] Reconnection queue persistence (offline WS messages survive reload)
- [ ] Token blacklist for JWT revocation
- [ ] Deployment guides (Docker, CI/CD)

See [DEVELOPMENT.md](./DEVELOPMENT.md) for detailed tasks.

---

## 📞 Quick Help

- **API Docs:** See [`API_REFERENCE.md`](API_REFERENCE.md)
- **Dev Guide:** See [`DEVELOPMENT.md`](DEVELOPMENT.md)
- **Architecture:** See [`PROJECT_STRUCTURE_AND_WORKFLOW.md`](PROJECT_STRUCTURE_AND_WORKFLOW.md)
- **Backend Details:** See [`BACKEND_WORKFLOW.md`](BACKEND_WORKFLOW.md)
- **WebSocket Events:** See [`PROJECT_STRUCTURE_AND_WORKFLOW.md`](PROJECT_STRUCTURE_AND_WORKFLOW.md) §6
