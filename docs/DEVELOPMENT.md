# KneaChat Backend — Development Guide

## Overview

This guide provides detailed information for developers working on the KneaChat backend server implementation.

## Architecture

KneaChat follows a **layered architecture** on the backend:

1. **Routes** (`src/routes/`)
   - Express route definitions — map URLs to controller methods
   - Each route file creates a router and mounts it in `app.ts`
   - Public routes: `/api/auth`, `/api/health`, `/api/omni`, `/api/website`, `/api/telegram`, `/api/email`
   - Protected routes: `/api/users`, `/api/teams`, `/api/channels`, `/api/conversations`, etc.

2. **Controllers** (`src/controllers/`)
   - Thin HTTP handlers — parse `req`, call a service, build the JSON response
   - One controller module per domain (auth, user, team, channel, conversation, message, notification, company, search, systemSetting, etc.)
   - 27 controllers total

3. **Services** (`src/services/`)
   - Business logic, validation, cross-entity rules
   - One service module per domain
   - 29 services total

4. **Repositories** (`src/repositories/`)
   - Data access — raw SQL queries through the connection pool
   - One repository module per table/aggregate
   - 35 repositories total

Request flow: **Route → Controller → Service → Repository → MySQL**.

## Key Files Overview

### Server Initialization

- `src/server.ts` — Main Express + WebSocket server setup, middleware configuration, route mounting, background schedulers
- `src/app.ts` — Express app (middleware, route mounting, CORS, static files)
- `src/container.ts` — Composition root (DI wiring)

### Middleware

- `src/middleware/auth.middleware.ts` — JWT authentication and role-based authorization
- `src/middleware/error.middleware.ts` — Centralized error handling

### Database

- `src/database/connection.ts` — MySQL connection pool management
- `src/cache/redisClient.ts` — Redis client with memory fallback

### API Routes

- `src/routes/auth.routes.ts` — Authentication endpoints (public)
- `src/routes/user.routes.ts` — User management (protected)
- `src/routes/team.routes.ts` — Team operations
- `src/routes/channel.routes.ts` — Channel management
- `src/routes/conversation.routes.ts` — Conversation management
- `src/routes/message.routes.ts` — Message operations
- `src/routes/search.routes.ts` — Search functionality
- `src/routes/notification.routes.ts` — Notification management
- `src/routes/attendance.routes.ts` — Attendance operations
- `src/routes/meeting.routes.ts` — Meeting operations
- `src/routes/task.routes.ts` — Task operations
- `src/routes/announcement.routes.ts` — Announcement operations
- `src/routes/sharedFile.routes.ts` — Shared file operations

### Omni-Channel Integrations

- `src/integrations/telegram/` — Telegram bot integration
- `src/integrations/website/` — Website widget integration
- `src/integrations/email/` — Email integration
- `src/integrations/omni/` — Shared omni-channel engine

### WebSocket

- `src/websocket/websocket.server.ts` — Main WebSocket setup and event routing
- `src/websocket/message.handler.ts` — Message-related WebSocket events
- `src/websocket/typing.handler.ts` — Typing indicator events
- `src/websocket/presence.handler.ts` — Presence/status events
- `src/websocket/call.handler.ts` — Voice/video call signaling
- `src/websocket/broadcast.utils.ts` — Broadcast utilities
- `src/websocket/connection.registry.ts` — Connection registry

### Utilities

- `src/utils/auth.utils.ts` — JWT token and password utilities
- `src/utils/errors.utils.ts` — DB error sanitization
- `src/utils/mentions.utils.ts` — @-mention extraction
- `src/utils/permissions.ts` — Discretionary permission catalog
- `src/utils/roles.ts` — RBAC hierarchy
- `src/utils/uploads.ts` — Upload directory resolution
- `src/utils/plans.ts` — Subscription plan definitions

### Types

- `src/types/` — Domain type definitions (24 type files)
- `src/types/express.d.ts` — Augments Express Request with user

## Implementation Status

The backend is fully implemented with:
- 27 controllers handling all REST endpoints
- 29 services with business logic
- 35 repositories for data access
- 28 route files
- WebSocket server with handlers for messages, typing, presence, calls
- Omni-channel adapters for Telegram, Website, and Email
- Background schedulers for reminders, meetings, tasks, announcements

## Database Implementation

### Using mysql2 directly (Current Setup)

All queries are executed through the connection pool in `src/database/connection.ts`:

```typescript
const { query } = require("../database/connection");

// Execute query
const results = await query("SELECT * FROM users WHERE id = ?", [userId]);
```

### Transaction Support

```typescript
const result = await db.transaction(async (trx) => {
  const [user] = await trx.query("INSERT INTO users ...", []);
  const [team] = await trx.query("INSERT INTO teams ...", []);
  return { user, team };
});
```

## Security Considerations

### Password Handling

- Always hash passwords with bcrypt (minimum 10 rounds)
- Never store plain text passwords
- Implement password reset with secure tokens

### JWT Tokens

- Use strong secret key (change in production)
- Set appropriate expiration times
- Validate token signature and expiration
- Token includes `jti` (UUID) for unique token per session

### Input Validation

- Validate all user inputs on server side
- Sanitize data to prevent SQL injection
- Use parameterized queries (already implemented)
- Implement rate limiting on auth endpoints

### Authorization

- Always check user permissions before operations
- Implement role-based access control (RBAC)
- Verify resource ownership
- Log unauthorized access attempts

## Data Flow Examples

### Authentication Flow

```
Client Login → POST /api/auth/login
  ↓
Server validates email/password
  ↓
Server generates JWT token (with id, email, role, companyId, jti)
  ↓
Create session record
  ↓
Return token + user to client
  ↓
Client stores token (localStorage/session)
  ↓
Client includes token in all protected requests
  ↓
Client connects WebSocket: ws://host?token=<token>
  ↓
Server verifies JWT, registers socket
  ↓
Server sends connection_ack
```

### Real-Time Message Flow

```
Client A opens message → WebSocket connects with token
  ↓
Server authenticates WebSocket connection
  ↓
User A types message → send_message event
  ↓
Server validates authorization
  ↓
Server saves message to database
  ↓
Server broadcasts to all conversation members
  ↓
All connected clients receive message_received event
  ↓
Client UI updates in real-time
```

### Omni-Channel Inbound Flow

```
External user sends message to Telegram/Website/Email
  ↓
Provider sends webhook to /api/<channel>/webhook
  ↓
Controller validates secret token
  ↓
OmniChannelService.processInbound()
  ↓
Adapter.parseInbound() → [OmniInboundMessage]
  ↓
findOrCreateContact() — creates shadow user if new
  ↓
findOrCreateConversation() — creates conversation + joins agents
  ↓
createInboundMessage() — persists message + attachment + notification
  ↓
broadcastInboundMessage() — sends 'receive_message' to agents
  ↓
Agents see new message in Omni Inbox (real-time via WebSocket)
```

## Testing

### E2E Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run specific E2E test
node e2e/notifications.e2e.js
node e2e/telegram-omni.e2e.js
node e2e/email-omni.e2e.js
node e2e/attendance.e2e.js
```

### E2E Test Structure

E2E tests are standalone scripts that:
1. Start the server
2. Authenticate test users
3. Perform REST + WebSocket actions
4. Assert on responses
5. Clean up test data

## Performance Optimization

### Database

- Connection pooling (already implemented, limit: 10)
- Query optimization with indexes
- Transaction support for complex operations

### API

- CORS configuration
- Body parsing limits
- Static file serving for uploads

### WebSocket

- Connection registry for efficient broadcasting
- Redis pub/sub for cross-instance events
- Heartbeat for connection health

## Debugging

### Enable Debug Logging

```bash
DEBUG=* npm run dev
```

### Common Issues & Solutions

**WebSocket Connection Fails**

- Check token in URL query parameter
- Verify JWT secret matches
- Check CORS settings
- Verify server is running

**Database Connection Error**

- Check MySQL is running
- Verify connection credentials in .env
- Check database exists
- Check user permissions

**Authentication Fails**

- Verify JWT_SECRET in .env
- Check token format
- Verify token hasn't expired
- Check role-based permissions

## Deployment Checklist

- [ ] Update JWT_SECRET to strong value
- [ ] Set NODE_ENV=production
- [ ] Enable HTTPS/WSS
- [ ] Set up database backups
- [ ] Configure rate limiting
- [ ] Set up logging/monitoring
- [ ] Configure CORS properly
- [ ] Test all endpoints
- [ ] Load test WebSocket connections
- [ ] Security audit

## References

- Express.js Documentation: https://expressjs.com/
- WebSocket API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- JWT: https://jwt.io/
- MySQL Documentation: https://dev.mysql.com/doc/
- bcrypt: https://github.com/kelektiv/node.bcrypt.js
