# KneaChat Backend - Development Guide

## 📚 Overview

This guide provides detailed information for developers working on the KneaChat backend server implementation.

## 🎯 Architecture

KneaChat follows the **MVC (Model–View–Controller)** pattern on the backend:

1. **Controller** (`src/controllers/`)
   - HTTP request handlers — parse `req`, call a service, build the JSON response
   - One controller module per domain (auth, user, team, channel, conversation, message, notification, company, search, systemSetting)

2. **View** (`src/routes/` + JSON responses)
   - Route files are thin: they only map URLs → controller methods and attach auth middleware
   - The JSON payloads produced by controllers are the view

3. **Model** (`src/services/` + `src/models/`)
   - Services: business logic, validation, cross-entity rules
   - Models: database access — parameterized SQL through the connection pool in `src/database/connection.js`

Request flow: **Route → Controller → Service → Model → MySQL**.

The frontend is a separate React + TypeScript client following **MVVM (Model–View–ViewModel)**; see `README.md` → Architecture for the full mapping.

## 📝 Key Files Overview

### Server Initialization

- `src/server.js` - Main Express server setup, middleware configuration, and route mounting

### Middleware

- `src/middleware/auth.middleware.js` - JWT authentication and role-based authorization
- `src/middleware/error.middleware.js` - Centralized error handling

### API Routes

- `src/routes/auth.routes.js` - Authentication endpoints (public)
- `src/routes/user.routes.js` - User management (protected)
- `src/routes/team.routes.js` - Team operations
- `src/routes/channel.routes.js` - Channel management
- `src/routes/conversation.routes.js` - Conversation management
- `src/routes/message.routes.js` - Message operations
- `src/routes/search.routes.js` - Search functionality
- `src/routes/notification.routes.js` - Notification management

### WebSocket

- `src/websocket/websocket.server.js` - Main WebSocket setup and event routing
- `src/websocket/message.handler.js` - Message-related WebSocket events
- `src/websocket/presence.handler.js` - Presence/status events
- `src/websocket/typing.handler.js` - Typing indicator events

### Database

- `src/database/connection.js` - MySQL connection pool management

### Utilities

- `src/utils/auth.utils.js` - JWT token and password utilities
- `src/utils/response.utils.js` - Standard response formatting
- `src/utils/validators.js` - Input validation functions

## 🔧 Implementation Tasks

### Priority 1: Core Database Models (High Priority)

Create model files in `src/models/`:

- [ ] User.js - User CRUD operations
- [ ] Team.js - Team management
- [ ] Channel.js - Channel operations
- [ ] Conversation.js - Conversation management
- [ ] Message.js - Message operations
- [ ] Notification.js - Notification system

**Example Model Structure:**

```javascript
class User {
  static async findById(id) {
    /* ... */
  }
  static async findByEmail(email) {
    /* ... */
  }
  static async create(data) {
    /* ... */
  }
  static async update(id, data) {
    /* ... */
  }
  static async delete(id) {
    /* ... */
  }
}
```

### Priority 2: Service Layer (Medium Priority)

Create service files in `src/services/`:

- [ ] UserService.js - User business logic
- [ ] AuthService.js - Authentication logic
- [ ] MessageService.js - Message operations
- [ ] ConversationService.js - Conversation logic
- [ ] NotificationService.js - Notification handling

**Service Pattern:**

```javascript
class AuthService {
  static async login(email, password) {
    /* ... */
  }
  static async logout(userId) {
    /* ... */
  }
  static async refreshToken(userId) {
    /* ... */
  }
}
```

### Priority 3: Database Operations (High Priority)

- [ ] Implement actual database queries in models
- [ ] Add transaction support for complex operations
- [ ] Add query error handling and logging
- [ ] Implement connection pooling optimization

### Priority 4: Validation & Error Handling (Medium Priority)

- [ ] Add comprehensive input validation
- [ ] Implement custom error classes
- [ ] Add error logging system
- [ ] Implement retry logic for failed operations

### Priority 5: API Implementation (High Priority)

- [ ] Complete authentication endpoints (login, logout, refresh)
- [ ] Implement user CRUD endpoints
- [ ] Implement team management endpoints
- [ ] Implement channel management endpoints
- [ ] Implement conversation endpoints
- [ ] Implement message endpoints with proper authorization

### Priority 6: WebSocket Features (High Priority)

- [ ] Message delivery and acknowledgment
- [ ] Typing indicator management
- [ ] Presence/status tracking
- [ ] Connection authentication and validation
- [ ] Reconnection handling

### Priority 7: Testing & Quality (Medium Priority)

- [ ] Unit tests for services
- [ ] Integration tests for API endpoints
- [ ] WebSocket event tests
- [ ] Authorization/permission tests
- [ ] Error scenario tests

## 💾 Database Implementation

### Using mysql2 directly (Current Setup)

All queries are executed through the connection pool in `src/database/connection.js`:

```javascript
const { query } = require("../database/connection");

// Execute query
const results = await query("SELECT * FROM users WHERE id = ?", [userId]);
```

### Future: Consider Using an ORM

- **Sequelize** - Most popular, great documentation
- **TypeORM** - For TypeScript projects (future)
- **Knex.js** - Query builder with good flexibility

## 🔐 Security Considerations

### Password Handling

- Always hash passwords with bcrypt (minimum 10 rounds)
- Never store plain text passwords
- Implement password reset with secure tokens

### JWT Tokens

- Use strong secret key (change in production)
- Set appropriate expiration times
- Validate token signature and expiration
- Consider token blacklist for logout

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

## 📊 Data Flow Examples

### Authentication Flow

```
Client Login → POST /api/auth/login
  ↓
Server validates email/password
  ↓
Server generates JWT token
  ↓
Return token to client
  ↓
Client stores token (localStorage/session)
  ↓
Client includes token in all protected requests
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

## 🧪 Testing

### Running Tests

```bash
npm test
```

### Test Structure

Create test files in `src/__tests__/`:

- `routes.test.js` - API endpoint tests
- `models.test.js` - Model tests
- `services.test.js` - Service logic tests
- `websocket.test.js` - WebSocket event tests

### Example Test

```javascript
describe("Auth Routes", () => {
  test("POST /api/auth/login should return token", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: "test@example.com", password: "password123" });

    expect(response.status).toBe(200);
    expect(response.body.data.token).toBeDefined();
  });
});
```

## 📈 Performance Optimization

### Database

- [ ] Add indexes on frequently queried columns
- [ ] Implement query pagination
- [ ] Use connection pooling (already done)
- [ ] Cache frequently accessed data

### API

- [ ] Implement response compression
- [ ] Add caching headers
- [ ] Implement rate limiting
- [ ] Use CDN for static files

### WebSocket

- [ ] Implement message batching
- [ ] Add connection idle timeout
- [ ] Implement reconnection with exponential backoff
- [ ] Monitor memory usage

## 🐛 Debugging

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
- Check token format (Bearer <token>)
- Verify token hasn't expired
- Check role-based permissions

## 📚 References

- Express.js Documentation: https://expressjs.com/
- WebSocket API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- JWT: https://jwt.io/
- MySQL Documentation: https://dev.mysql.com/doc/
- bcrypt: https://github.com/kelektiv/node.bcrypt.js

## 🚀 Deployment Checklist

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

---

**Document Version:** 1.0  
**Last Updated:** August 2024
