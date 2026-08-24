# 🚀 KneaChat Backend - Quick Start Guide

## ⚡ 5-Minute Setup

### Step 1: Install Dependencies

```bash
cd chat_websocket
npm install
```

### Step 2: Configure Environment

```bash
cp .env.example .env
# Edit .env with your MySQL credentials
```

### Step 3: Create Database

```bash
mysql -u root -p
CREATE DATABASE kneachat;
EXIT;
```

### Step 4: Start Server

```bash
npm run dev
```

✅ Server running on `http://localhost:8080`

---

## 📡 Test the API

### Login (Get JWT Token)

```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
```

**Response:**

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      /* user info */
    },
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
├── src/
│   ├── server.js              ← Main Express server
│   ├── middleware/            ← JWT, error handling
│   ├── routes/                ← API endpoints
│   ├── websocket/             ← Real-time handlers
│   ├── database/              ← MySQL connection
│   ├── models/                ← TODO: Database models
│   ├── services/              ← TODO: Business logic
│   └── utils/                 ← Helpers, validators
├── .env                       ← Environment config
├── .env.example               ← Config template
├── package.json               ← Dependencies
├── README.md                  ← Full documentation
├── DEVELOPMENT.md             ← Dev guide
└── QUICK_START.md             ← This file
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
DB_USER=root
DB_PASSWORD=
DB_NAME=kneachat

# JWT
JWT_SECRET=dev-secret-key

# Client URL (CORS)
CORS_ORIGIN=http://localhost:3000
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
CORS_ORIGIN=http://localhost:3000  # ← Update this
```

---

## 📊 What's Implemented ✅

- [x] Express.js server setup
- [x] JWT authentication middleware
- [x] Error handling middleware
- [x] REST API route structure (7 route files)
- [x] WebSocket server setup
- [x] Real-time event handlers (messages, presence, typing)
- [x] MySQL connection pool
- [x] Environment configuration
- [x] Response formatting utilities
- [x] Input validation utilities
- [x] Password hashing (bcrypt)
- [x] CORS configuration

---

## 📋 What's Next 📝

**High Priority (Do First):**

1. Implement database models (User, Team, Channel, Message, etc.)
2. Connect routes to actual database queries
3. Implement complete WebSocket message persistence

**Medium Priority:**

1. Add comprehensive input validation
2. Implement error logging
3. Add rate limiting
4. Write unit tests

**Lower Priority:**

1. Add API documentation (Swagger)
2. Implement file uploads
3. Add analytics/monitoring
4. Performance optimization

See [DEVELOPMENT.md](./DEVELOPMENT.md) for detailed tasks.

---

## 🔗 Frontend Connection

React frontend should connect like this:

```javascript
// src/services/websocket.js
const token = localStorage.getItem("authToken");
const ws = new WebSocket(`ws://localhost:8080?token=${token}`);

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  // Handle message...
};
```

---

## 📞 Quick Help

- **API Docs:** See [README.md](./README.md)
- **Dev Guide:** See [DEVELOPMENT.md](./DEVELOPMENT.md)
- **Database Schema:** See SRS Appendix B
- **WebSocket Events:** See [README.md](./README.md#-websocket-events)

---

## ✨ Pro Tips

1. **Use Postman** for testing REST endpoints
   - Import methods from README.md
   - Set Bearer token in Authorization

2. **Use `wscat`** for WebSocket testing
   - Much easier than browser console
   - Can send/receive JSON events easily

3. **Check `.env`** first for connection issues
   - DB credentials
   - JWT secret
   - Port conflicts

4. **Monitor logs** for debugging
   - Look for 🔌, 📨, ✅, ❌ emojis
   - Shows connection, message, success, error states

5. **Backend changes auto-reload**
   - Using `npm run dev` (nodemon)
   - Just save files and server restarts

---

**Now you're ready to start developing! 🎉**

See [DEVELOPMENT.md](./DEVELOPMENT.md) for implementation tasks.
