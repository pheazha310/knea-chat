# KneaChat — API Reference

**Base URL:** `http://localhost:8080`  
**WebSocket:** `ws://localhost:8080`  
**Authentication:** JWT Bearer token in `Authorization` header (REST) or `?token=` query param (WebSocket)

## Table of Contents

1. [Authentication](#1-authentication)
2. [Users](#2-users)
3. [Teams](#3-teams)
4. [Channels](#4-channels)
5. [Conversations](#5-conversations)
6. [Messages](#6-messages)
7. [Search](#7-search)
8. [Notifications](#8-notifications)
9. [Companies](#9-companies)
10. [Departments](#10-departments)
11. [Announcements](#11-announcements)
12. [Meetings](#12-meetings)
13. [Attendance](#13-attendance)
14. [Overtime](#14-overtime)
15. [Work Schedules](#15-work-schedules)
16. [Leave Requests](#16-leave-requests)
17. [Holidays](#17-holidays)
18. [Tasks](#18-tasks)
19. [Shared Files](#19-shared-files)
20. [Bookmarks](#20-bookmarks)
21. [Reminders](#21-reminders)
22. [Settings](#22-settings)
23. [Company Settings](#23-company-settings)
24. [Audit Logs](#24-audit-logs)
25. [Subscriptions](#25-subscriptions)
26. [Platform Metrics](#26-platform-metrics)
27. [Notification Preferences](#27-notification-preferences)
28. [Telegram Integration](#28-telegram-integration)
29. [Website Integration](#29-website-integration)
30. [Omni-Channel](#30-omni-channel)
31. [WebSocket Events](#31-websocket-events)

---

## 1. Authentication

### POST /api/auth/register
Register a new user account.

**Auth:** None (rate limited)

**Request body:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "firstName": "John",
  "lastName": "Doe",
  "companyId": 1
}
```

**Response 201:**
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "user": { "id": 1, "email": "user@example.com", "firstName": "John", "lastName": "Doe" },
    "token": "eyJhbGc...",
    "expiresIn": "24h"
  }
}
```

---

### POST /api/auth/login
Authenticate and receive a JWT token.

**Auth:** None (rate limited)

**Request body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response 200:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": { "id": 1, "email": "user@example.com", "role": "employee" },
    "token": "eyJhbGc...",
    "expiresIn": "24h"
  }
}
```

---

### POST /api/auth/logout
Invalidate the current session.

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Logged out successfully" }
```

---

### POST /api/auth/refresh
Refresh the JWT token.

**Auth:** Required

**Response 200:**
```json
{
  "success": true,
  "data": { "token": "eyJhbGc...", "expiresIn": "24h" }
}
```

---

### POST /api/auth/forgot-password
Request a password reset link.

**Auth:** None (rate limited)

**Request body:**
```json
{ "email": "user@example.com" }
```

**Response 200:**
```json
{ "success": true, "message": "Password reset email sent" }
```

---

### POST /api/auth/reset-password
Reset password using a token.

**Auth:** None (rate limited)

**Request body:**
```json
{
  "token": "reset-token-here",
  "password": "newpassword123"
}
```

**Response 200:**
```json
{ "success": true, "message": "Password reset successful" }
```

---

### POST /api/auth/change-password
Change the current user's password.

**Auth:** Required

**Request body:**
```json
{
  "currentPassword": "oldpassword123",
  "newPassword": "newpassword123"
}
```

**Response 200:**
```json
{ "success": true, "message": "Password changed successfully" }
```

---

### GET /api/auth/sessions
List the current user's login sessions.

**Auth:** Required

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "device": "Chrome on macOS",
      "ip": "192.168.1.1",
      "createdAt": "2026-09-17T03:00:00Z",
      "status": "active"
    }
  ]
}
```

---

### POST /api/auth/sessions/revoke-others
Sign out all other sessions except the current one.

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Other sessions revoked" }
```

---

### GET /api/auth/me
Get the current authenticated user profile.

**Auth:** Required

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "employee",
    "companyId": 1,
    "status": "online"
  }
}
```

---

## 2. Users

### GET /api/users
List all users in the company.

**Auth:** Required

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "email": "user@example.com", "firstName": "John", "lastName": "Doe", "role": "employee" }
  ]
}
```

---

### GET /api/users/search
Search users by name or email.

**Auth:** Required

**Query params:** `q=searchTerm`

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "email": "user@example.com", "firstName": "John", "lastName": "Doe" }
  ]
}
```

---

### GET /api/users/:id
Get a specific user by ID.

**Auth:** Required

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "email": "user@example.com", "firstName": "John", "lastName": "Doe", "role": "employee" }
}
```

---

### GET /api/users/:id/sessions
Get a user's login sessions (admin+ only).

**Auth:** Required (`admin` or higher)

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "device": "Chrome on macOS",
      "ip": "192.168.1.1",
      "createdAt": "2026-09-17T03:00:00Z",
      "status": "active"
    }
  ]
}
```

---

### POST /api/users
Create a new user (admin+ only).

**Auth:** Required (`admin` or higher)

**Request body:**
```json
{
  "email": "newuser@example.com",
  "password": "password123",
  "firstName": "Jane",
  "lastName": "Doe",
  "role": "employee",
  "companyId": 1
}
```

**Response 201:**
```json
{
  "success": true,
  "data": { "id": 2, "email": "newuser@example.com", "firstName": "Jane", "lastName": "Doe", "role": "employee" }
}
```

---

### POST /api/users/:id/avatar
Upload a user avatar.

**Auth:** Required

**Request:** `multipart/form-data` with `avatar` file field

**Response 200:**
```json
{
  "success": true,
  "data": { "avatarUrl": "/uploads/avatars/avatar-1-1234567890.png" }
}
```

---

### PATCH /api/users/:id
Update a user profile.

**Auth:** Required (users can update their own profile; admin+ can update any)

**Request body:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "jobTitle": "Software Engineer",
  "status": "online"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "firstName": "John", "lastName": "Doe", "jobTitle": "Software Engineer", "status": "online" }
}
```

---

### DELETE /api/users/:id
Delete a user (admin+ only).

**Auth:** Required (`admin` or higher)

**Response 200:**
```json
{ "success": true, "message": "User deleted successfully" }
```

---

## 3. Teams

### GET /api/teams
List teams accessible to the current user.

**Auth:** Required

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Engineering",
      "description": "Engineering team",
      "companyId": 1,
      "memberCount": 5,
      "isMember": true
    }
  ]
}
```

---

### POST /api/teams
Create a new team.

**Auth:** Required (`manager` or higher, or has `create_teams` capability)

**Request body:**
```json
{
  "name": "Engineering",
  "description": "Engineering team",
  "companyId": 1,
  "memberIds": [1, 2, 3]
}
```

**Response 201:**
```json
{
  "success": true,
  "data": { "id": 1, "name": "Engineering", "description": "Engineering team", "companyId": 1 }
}
```

---

### GET /api/teams/:id
Get a specific team.

**Auth:** Required

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Engineering",
    "description": "Engineering team",
    "companyId": 1,
    "members": [
      { "id": 1, "firstName": "John", "lastName": "Doe", "role": "manager" }
    ]
  }
}
```

---

### PATCH /api/teams/:id
Update a team (team creator, manager+, or admin+).

**Auth:** Required

**Request body:**
```json
{
  "name": "Engineering",
  "description": "Updated description"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "name": "Engineering", "description": "Updated description" }
}
```

---

### DELETE /api/teams/:id
Delete a team (manager+ with `manage_teams` capability, or team creator).

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Team deleted successfully" }
```

---

### POST /api/teams/:id/members
Add a member to a team.

**Auth:** Required (manager+ or team creator)

**Request body:**
```json
{ "userId": 2, "role": "member" }
```

**Response 200:**
```json
{ "success": true, "message": "Member added to team" }
```

---

### DELETE /api/teams/:id/members/:memberId
Remove a member from a team.

**Auth:** Required (manager+ or team creator)

**Response 200:**
```json
{ "success": true, "message": "Member removed from team" }
```

---

### GET /api/teams/:id/members
List members of a team.

**Auth:** Required

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "firstName": "John", "lastName": "Doe", "role": "manager", "joinedAt": "2026-09-01T00:00:00Z" }
  ]
}
```

---

## 4. Channels

### GET /api/channels
List channels accessible to the current user.

**Auth:** Required

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "general",
      "type": "channel",
      "teamId": 1,
      "isPrivate": false,
      "memberCount": 10
    }
  ]
}
```

---

### POST /api/channels
Create a new channel.

**Auth:** Required (manager+ for standalone; employee+ within owned team)

**Request body:**
```json
{
  "name": "general",
  "type": "channel",
  "teamId": 1,
  "isPrivate": false,
  "memberIds": [1, 2, 3]
}
```

**Response 201:**
```json
{
  "success": true,
  "data": { "id": 1, "name": "general", "type": "channel", "teamId": 1, "isPrivate": false }
}
```

---

### GET /api/channels/:id
Get a specific channel.

**Auth:** Required (must be a member)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "general",
    "type": "channel",
    "teamId": 1,
    "isPrivate": false,
    "members": [
      { "id": 1, "firstName": "John", "lastName": "Doe" }
    ]
  }
}
```

---

### PATCH /api/channels/:id
Update a channel.

**Auth:** Required (channel creator/admin, or team manager+)

**Request body:**
```json
{
  "name": "announcements",
  "isPrivate": true
}
```

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "name": "announcements", "isPrivate": true }
}
```

---

### DELETE /api/channels/:id
Delete a channel.

**Auth:** Required (`manager` or higher)

**Response 200:**
```json
{ "success": true, "message": "Channel deleted successfully" }
```

---

### POST /api/channels/:id/members
Add a member to a channel.

**Auth:** Required

**Request body:**
```json
{ "userId": 2 }
```

**Response 200:**
```json
{ "success": true, "message": "Member added to channel" }
```

---

### DELETE /api/channels/:id/members/:memberId
Remove a member from a channel.

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Member removed from channel" }
```

---

### GET /api/channels/:id/members
List channel members.

**Auth:** Required (must be a member)

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "firstName": "John", "lastName": "Doe", "role": "manager", "joinedAt": "2026-09-01T00:00:00Z" }
  ]
}
```

---

## 5. Conversations

### GET /api/conversations
List conversations for the current user.

**Auth:** Required

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "type": "direct",
      "name": "John Doe",
      "lastMessage": { "id": 10, "content": "Hello", "createdAt": "2026-09-17T03:00:00Z" },
      "unreadCount": 2
    }
  ]
}
```

---

### POST /api/conversations
Create a group conversation.

**Auth:** Required

**Request body:**
```json
{
  "name": "Project Discussion",
  "type": "group",
  "memberIds": [1, 2, 3]
}
```

**Response 201:**
```json
{
  "success": true,
  "data": { "id": 1, "name": "Project Discussion", "type": "group", "memberIds": [1, 2, 3] }
}
```

---

### GET /api/conversations/:id
Get a specific conversation.

**Auth:** Required (must be a member)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "type": "direct",
    "name": "John Doe",
    "members": [
      { "id": 1, "firstName": "John", "lastName": "Doe" }
    ]
  }
}
```

---

### POST /api/conversations/:id/members
Add a member to a conversation.

**Auth:** Required (conversation admin or manager+)

**Request body:**
```json
{ "userId": 2 }
```

**Response 200:**
```json
{ "success": true, "message": "Member added to conversation" }
```

---

### GET /api/conversations/:id/messages
Get messages for a conversation.

**Auth:** Required (must be a member)

**Query params:** `before=messageId&limit=50`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "conversationId": 1,
      "senderId": 1,
      "content": "Hello",
      "type": "text",
      "createdAt": "2026-09-17T03:00:00Z"
    }
  ]
}
```

---

### POST /api/conversations/direct
Create or get a direct conversation with another user.

**Auth:** Required

**Request body:**
```json
{ "userId": 2 }
```

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "type": "direct", "members": [1, 2] }
}
```

---

## 6. Messages

### POST /api/messages
Send a message to a conversation.

**Auth:** Required (must be a member)

**Request body:**
```json
{
  "conversationId": 1,
  "content": "Hello, world!",
  "type": "text",
  "replyTo": null
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "conversationId": 1,
    "senderId": 1,
    "content": "Hello, world!",
    "type": "text",
    "createdAt": "2026-09-17T03:00:00Z"
  }
}
```

---

### GET /api/messages/:id
Get a specific message.

**Auth:** Required (must be a member of the conversation)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "conversationId": 1,
    "senderId": 1,
    "content": "Hello, world!",
    "type": "text",
    "createdAt": "2026-09-17T03:00:00Z"
  }
}
```

---

### POST /api/messages/upload
Upload a file attachment for a message.

**Auth:** Required

**Request:** `multipart/form-data` with `file` field

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "fileName": "document.pdf",
    "fileUrl": "/uploads/files/document-1234567890.pdf",
    "fileSize": 102400,
    "mimeType": "application/pdf"
  }
}
```

---

### PATCH /api/messages/:id
Edit a message (sender only, within edit window).

**Auth:** Required

**Request body:**
```json
{ "content": "Updated message content" }
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "content": "Updated message content",
    "updatedAt": "2026-09-17T03:05:00Z"
  }
}
```

---

### DELETE /api/messages/:id
Delete a message (sender or admin+).

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Message deleted successfully" }
```

---

### POST /api/messages/:id/forward
Forward a message to another conversation.

**Auth:** Required (must be a member of both conversations)

**Request body:**
```json
{ "targetConversationId": 2 }
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": 2,
    "conversationId": 2,
    "content": "Hello, world!",
    "type": "text",
    "createdAt": "2026-09-17T03:05:00Z"
  }
}
```

---

### GET /api/messages/:id/thread
Get thread/replies for a message.

**Auth:** Required (must be a member)

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 2,
      "parentId": 1,
      "conversationId": 1,
      "senderId": 2,
      "content": "Reply",
      "createdAt": "2026-09-17T03:01:00Z"
    }
  ]
}
```

---

### POST /api/messages/:id/pin
Pin a message in a conversation.

**Auth:** Required (must be a member)

**Response 200:**
```json
{ "success": true, "message": "Message pinned" }
```

---

### DELETE /api/messages/:id/pin
Unpin a message.

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Message unpinned" }
```

---

### POST /api/messages/:id/reactions
Add a reaction to a message.

**Auth:** Required (must be a member)

**Request body:**
```json
{ "reactionType": "👍" }
```

**Response 200:**
```json
{ "success": true, "message": "Reaction added" }
```

---

### DELETE /api/messages/:id/reactions/:reactionType
Remove a reaction from a message.

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Reaction removed" }
```

---

## 7. Search

### GET /api/search/messages
Search messages by content.

**Auth:** Required

**Query params:** `q=searchTerm&conversationId=1&limit=20`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "conversationId": 1,
      "senderId": 1,
      "content": "Hello, world!",
      "createdAt": "2026-09-17T03:00:00Z"
    }
  ]
}
```

---

### GET /api/search/users
Search users by name or email.

**Auth:** Required

**Query params:** `q=searchTerm`

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "email": "user@example.com", "firstName": "John", "lastName": "Doe" }
  ]
}
```

---

### GET /api/search/global
Global search across messages and users.

**Auth:** Required

**Query params:** `q=searchTerm`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "messages": [...],
    "users": [...]
  }
}
```

---

### GET /api/search/global/:scope
Global search scoped to a specific type.

**Auth:** Required

**Path params:** `scope=messages|users|channels|teams`

**Query params:** `q=searchTerm`

**Response 200:**
```json
{
  "success": true,
  "data": [...]
}
```

---

## 8. Notifications

### GET /api/notifications
List notifications for the current user.

**Auth:** Required

**Query params:** `unreadOnly=true&limit=20`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "type": "new_message",
      "title": "John Doe",
      "message": "Hello, world!",
      "isRead": false,
      "createdAt": "2026-09-17T03:00:00Z",
      "data": { "conversationId": 1, "messageId": 1 }
    }
  ]
}
```

---

### PATCH /api/notifications/:id/read
Mark a notification as read.

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Notification marked as read" }
```

---

### POST /api/notifications/read-all
Mark all notifications as read.

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "All notifications marked as read" }
```

---

### DELETE /api/notifications/:id
Delete a notification.

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Notification deleted" }
```

---

## 9. Companies

### GET /api/companies
List all companies (super_admin only).

**Auth:** Required (`super_admin`)

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "name": "Acme Corp", "domain": "acme.com", "userCount": 10, "createdAt": "2026-01-01T00:00:00Z" }
  ]
}
```

---

### GET /api/companies/:id
Get a specific company.

**Auth:** Required (`super_admin`)

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "name": "Acme Corp", "domain": "acme.com", "userCount": 10 }
}
```

---

### POST /api/companies
Create a new company (super_admin only).

**Auth:** Required (`super_admin`)

**Request body:**
```json
{
  "name": "Acme Corp",
  "domain": "acme.com",
  "adminUserId": 1
}
```

**Response 201:**
```json
{
  "success": true,
  "data": { "id": 1, "name": "Acme Corp", "domain": "acme.com" }
}
```

---

### PATCH /api/companies/:id
Update a company (super_admin only).

**Auth:** Required (`super_admin`)

**Request body:**
```json
{ "name": "Acme Corp Updated" }
```

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "name": "Acme Corp Updated" }
}
```

---

### DELETE /api/companies/:id
Delete a company (super_admin only).

**Auth:** Required (`super_admin`)

**Response 200:**
```json
{ "success": true, "message": "Company deleted successfully" }
```

---

### GET /api/companies/:id/users
List users in a company.

**Auth:** Required (`super_admin`)

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "email": "user@example.com", "firstName": "John", "lastName": "Doe", "role": "employee" }
  ]
}
```

---

### GET /api/companies/:id/admins
List admins of a company.

**Auth:** Required (`super_admin`)

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "email": "admin@example.com", "firstName": "Admin", "lastName": "User", "role": "admin" }
  ]
}
```

---

## 10. Departments

### GET /api/departments
List departments.

**Auth:** Required

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "name": "Engineering", "companyId": 1, "managerId": 1 }
  ]
}
```

---

### GET /api/departments/:id
Get a specific department.

**Auth:** Required

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "name": "Engineering", "companyId": 1, "managerId": 1 }
}
```

---

### POST /api/departments
Create a department (admin+ only).

**Auth:** Required (`admin` or higher)

**Request body:**
```json
{
  "name": "Engineering",
  "companyId": 1,
  "managerId": 1
}
```

**Response 201:**
```json
{
  "success": true,
  "data": { "id": 1, "name": "Engineering", "companyId": 1, "managerId": 1 }
}
```

---

### PATCH /api/departments/:id
Update a department (admin+ only).

**Auth:** Required (`admin` or higher)

**Request body:**
```json
{ "name": "Engineering", "managerId": 2 }
```

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "name": "Engineering", "managerId": 2 }
}
```

---

### DELETE /api/departments/:id
Delete a department (admin+ only).

**Auth:** Required (`admin` or higher)

**Response 200:**
```json
{ "success": true, "message": "Department deleted successfully" }
```

---

## 11. Announcements

### GET /api/announcements
List announcements.

**Auth:** Required

**Query params:** `departmentId=1&limit=20`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "Welcome",
      "content": "Welcome to the company!",
      "authorId": 1,
      "departmentId": 1,
      "createdAt": "2026-09-17T03:00:00Z",
      "readByCurrentUser": false
    }
  ]
}
```

---

### GET /api/announcements/:id
Get a specific announcement.

**Auth:** Required

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "title": "Welcome",
    "content": "Welcome to the company!",
    "authorId": 1,
    "departmentId": 1,
    "createdAt": "2026-09-17T03:00:00Z"
  }
}
```

---

### POST /api/announcements/:id/read
Mark an announcement as read.

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Announcement marked as read" }
```

---

### GET /api/announcements/:id/reads
List users who read an announcement (manager+ only).

**Auth:** Required (`manager` or higher)

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "userId": 1, "readAt": "2026-09-17T03:00:00Z" }
  ]
}
```

---

### POST /api/announcements/:id/reactions
Add a reaction to an announcement.

**Auth:** Required

**Request body:**
```json
{ "reactionType": "👍" }
```

**Response 200:**
```json
{ "success": true, "message": "Reaction added" }
```

---

### DELETE /api/announcements/:id/reactions/:reactionType
Remove a reaction from an announcement.

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Reaction removed" }
```

---

### POST /api/announcements
Create an announcement (requires `publish_announcements` capability).

**Auth:** Required

**Request body:**
```json
{
  "title": "Welcome",
  "content": "Welcome to the company!",
  "departmentId": 1,
  "targetUserIds": [1, 2, 3]
}
```

**Response 201:**
```json
{
  "success": true,
  "data": { "id": 1, "title": "Welcome", "content": "Welcome to the company!" }
}
```

---

### PATCH /api/announcements/:id
Update an announcement (requires `publish_announcements` capability).

**Auth:** Required

**Request body:**
```json
{ "title": "Updated Welcome", "content": "Updated content" }
```

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "title": "Updated Welcome", "content": "Updated content" }
}
```

---

### DELETE /api/announcements/:id
Delete an announcement (requires `publish_announcements` capability).

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Announcement deleted successfully" }
```

---

## 12. Meetings

### GET /api/meetings
List meetings.

**Auth:** Required

**Query params:** `startDate=2026-09-01&endDate=2026-09-30`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "Weekly Sync",
      "startTime": "2026-09-17T10:00:00Z",
      "endTime": "2026-09-17T11:00:00Z",
      "type": "video",
      "conversationId": 1,
      "createdBy": 1
    }
  ]
}
```

---

### GET /api/meetings/:id
Get a specific meeting.

**Auth:** Required (must be an attendee)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "title": "Weekly Sync",
    "startTime": "2026-09-17T10:00:00Z",
    "endTime": "2026-09-17T11:00:00Z",
    "type": "video",
    "conversationId": 1,
    "createdBy": 1,
    "attendees": [
      { "userId": 1, "rsvp": "accepted" }
    ]
  }
}
```

---

### GET /api/meetings/:id/ics
Export a meeting as an ICS calendar file.

**Auth:** Required (must be an attendee)

**Response 200:** `text/calendar`

---

### POST /api/meetings
Create a meeting.

**Auth:** Required

**Request body:**
```json
{
  "title": "Weekly Sync",
  "startTime": "2026-09-17T10:00:00Z",
  "endTime": "2026-09-17T11:00:00Z",
  "type": "video",
  "conversationId": 1,
  "attendeeIds": [1, 2, 3]
}
```

**Response 201:**
```json
{
  "success": true,
  "data": { "id": 1, "title": "Weekly Sync", "startTime": "2026-09-17T10:00:00Z", "endTime": "2026-09-17T11:00:00Z" }
}
```

---

### PATCH /api/meetings/:id
Update a meeting (manager+ only).

**Auth:** Required (`manager` or higher)

**Request body:**
```json
{
  "title": "Updated Weekly Sync",
  "startTime": "2026-09-17T11:00:00Z",
  "endTime": "2026-09-17T12:00:00Z"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "title": "Updated Weekly Sync", "startTime": "2026-09-17T11:00:00Z", "endTime": "2026-09-17T12:00:00Z" }
}
```

---

### DELETE /api/meetings/:id
Cancel a meeting (manager+ only).

**Auth:** Required (`manager` or higher)

**Response 200:**
```json
{ "success": true, "message": "Meeting cancelled successfully" }
```

---

### GET /api/meetings/:id/notes
List meeting notes.

**Auth:** Required (must be an attendee)

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "meetingId": 1, "content": "Discussed roadmap", "createdBy": 1, "createdAt": "2026-09-17T11:00:00Z" }
  ]
}
```

---

### POST /api/meetings/:id/notes
Create a meeting note.

**Auth:** Required (must be an attendee)

**Request body:**
```json
{ "content": "Discussed roadmap" }
```

**Response 201:**
```json
{
  "success": true,
  "data": { "id": 1, "meetingId": 1, "content": "Discussed roadmap", "createdBy": 1 }
}
```

---

### PATCH /api/meetings/:id/notes/:noteId
Update a meeting note.

**Auth:** Required (note author or meeting creator)

**Request body:**
```json
{ "content": "Updated roadmap discussion" }
```

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "content": "Updated roadmap discussion" }
}
```

---

### DELETE /api/meetings/:id/notes/:noteId
Delete a meeting note.

**Auth:** Required (note author or meeting creator)

**Response 200:**
```json
{ "success": true, "message": "Note deleted successfully" }
```

---

### GET /api/meetings/:id/reminders
List meeting reminders.

**Auth:** Required (must be an attendee)

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "meetingId": 1, "userId": 1, "remindAt": "2026-09-17T09:30:00Z", "createdAt": "2026-09-17T03:00:00Z" }
  ]
}
```

---

### POST /api/meetings/:id/reminders
Set a meeting reminder.

**Auth:** Required (must be an attendee)

**Request body:**
```json
{ "remindAt": "2026-09-17T09:30:00Z" }
```

**Response 201:**
```json
{
  "success": true,
  "data": { "id": 1, "meetingId": 1, "userId": 1, "remindAt": "2026-09-17T09:30:00Z" }
}
```

---

### DELETE /api/meetings/:id/reminders/:reminderId
Delete a meeting reminder.

**Auth:** Required (reminder owner)

**Response 200:**
```json
{ "success": true, "message": "Reminder deleted successfully" }
```

---

### PATCH /api/meetings/:id/recording
Update meeting recording URL (manager+ only).

**Auth:** Required (`manager` or higher)

**Request body:**
```json
{ "recordingUrl": "https://storage.example.com/recordings/meeting-1.mp4" }
```

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "recordingUrl": "https://storage.example.com/recordings/meeting-1.mp4" }
}
```

---

### PATCH /api/meetings/:id/calendar
Update meeting calendar event ID (manager+ only).

**Auth:** Required (`manager` or higher)

**Request body:**
```json
{ "calendarEventId": "google-calendar-event-id-123" }
```

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "calendarEventId": "google-calendar-event-id-123" }
}
```

---

### GET /api/meetings/:id/attendees
List meeting attendees.

**Auth:** Required (must be an attendee)

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "userId": 1, "rsvp": "accepted", "joinedAt": "2026-09-17T10:00:00Z" }
  ]
}
```

---

### POST /api/meetings/:id/attendees
Add an attendee to a meeting.

**Auth:** Required (meeting creator or manager+)

**Request body:**
```json
{ "userId": 2 }
```

**Response 201:**
```json
{
  "success": true,
  "data": { "meetingId": 1, "userId": 2, "rsvp": "pending" }
}
```

---

### PATCH /api/meetings/:id/attendees/rsvp
Update attendee RSVP.

**Auth:** Required (attendee or meeting creator)

**Request body:**
```json
{ "userId": 2, "rsvp": "accepted" }
```

**Response 200:**
```json
{
  "success": true,
  "data": { "meetingId": 1, "userId": 2, "rsvp": "accepted" }
}
```

---

### GET /api/meetings/:id/attachments
List meeting attachments.

**Auth:** Required (must be an attendee)

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "meetingId": 1, "fileName": "agenda.pdf", "fileUrl": "/uploads/files/agenda.pdf", "uploadedBy": 1 }
  ]
}
```

---

### POST /api/meetings/:id/attachments
Upload a meeting attachment.

**Auth:** Required (must be an attendee)

**Request:** `multipart/form-data` with `file` field

**Response 201:**
```json
{
  "success": true,
  "data": { "id": 1, "meetingId": 1, "fileName": "agenda.pdf", "fileUrl": "/uploads/files/agenda.pdf", "uploadedBy": 1 }
}
```

---

### DELETE /api/meetings/:id/attachments/:attachmentId
Delete a meeting attachment.

**Auth:** Required (uploader or meeting creator)

**Response 200:**
```json
{ "success": true, "message": "Attachment deleted successfully" }
```

---

## 13. Attendance

### POST /api/attendance/clock-in
Clock in for the day.

**Auth:** Required (rate limited)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "userId": 1,
    "clockIn": "2026-09-17T09:00:00Z",
    "status": "present"
  }
}
```

---

### POST /api/attendance/clock-out
Clock out for the day.

**Auth:** Required (rate limited)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "userId": 1,
    "clockIn": "2026-09-17T09:00:00Z",
    "clockOut": "2026-09-17T17:00:00Z",
    "status": "present"
  }
}
```

---

### POST /api/attendance/break/start
Start a break.

**Auth:** Required (rate limited)

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "userId": 1, "breakStart": "2026-09-17T12:00:00Z", "status": "on_break" }
}
```

---

### POST /api/attendance/break/end
End a break.

**Auth:** Required (rate limited)

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "userId": 1, "breakStart": "2026-09-17T12:00:00Z", "breakEnd": "2026-09-17T12:30:00Z", "status": "present" }
}
```

---

### GET /api/attendance/me/today
Get today's attendance for the current user.

**Auth:** Required

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "userId": 1,
    "clockIn": "2026-09-17T09:00:00Z",
    "clockOut": "2026-09-17T17:00:00Z",
    "breakStart": "2026-09-17T12:00:00Z",
    "breakEnd": "2026-09-17T12:30:00Z",
    "status": "present"
  }
}
```

---

### GET /api/attendance/me/month
Get the current user's attendance for the month.

**Auth:** Required

**Query params:** `month=2026-09`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "date": "2026-09-17",
      "clockIn": "2026-09-17T09:00:00Z",
      "clockOut": "2026-09-17T17:00:00Z",
      "status": "present"
    }
  ]
}
```

---

### GET /api/attendance/employees
List all employees' attendance (manager+ only).

**Auth:** Required (`manager` or higher)

**Query params:** `date=2026-09-17&departmentId=1`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "userId": 1,
      "firstName": "John",
      "lastName": "Doe",
      "clockIn": "2026-09-17T09:00:00Z",
      "clockOut": "2026-09-17T17:00:00Z",
      "status": "present"
    }
  ]
}
```

---

### GET /api/attendance/employee/:id
Get a specific employee's attendance detail (manager+ only).

**Auth:** Required (`manager` or higher)

**Query params:** `month=2026-09`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "userId": 1,
    "firstName": "John",
    "lastName": "Doe",
    "records": [
      {
        "date": "2026-09-17",
        "clockIn": "2026-09-17T09:00:00Z",
        "clockOut": "2026-09-17T17:00:00Z",
        "status": "present"
      }
    ],
    "summary": { "present": 20, "absent": 0, "late": 1, "onLeave": 2 }
  }
}
```

---

### GET /api/attendance/report
Get an attendance report (manager+ only).

**Auth:** Required (`manager` or higher)

**Query params:** `startDate=2026-09-01&endDate=2026-09-30&departmentId=1`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "summary": { "present": 200, "absent": 5, "late": 10, "onLeave": 15 },
    "employees": [
      { "userId": 1, "firstName": "John", "lastName": "Doe", "present": 20, "absent": 0, "late": 1, "onLeave": 2 }
    ]
  }
}
```

---

### GET /api/attendance/dashboard
Get attendance dashboard data (manager+ only).

**Auth:** Required (`manager` or higher)

**Query params:** `month=2026-09`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "todayPresent": 45,
    "todayAbsent": 3,
    "todayLate": 2,
    "monthlyPresent": 800,
    "monthlyAbsent": 20,
    "departmentBreakdown": [
      { "departmentId": 1, "departmentName": "Engineering", "present": 25, "absent": 1 }
    ]
  }
}
```

---

## 14. Overtime

### POST /api/overtime
Submit an overtime request.

**Auth:** Required

**Request body:**
```json
{
  "date": "2026-09-17",
  "hours": 2,
  "reason": "Deploy hotfix"
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "userId": 1,
    "date": "2026-09-17",
    "hours": 2,
    "reason": "Deploy hotfix",
    "status": "pending",
    "createdAt": "2026-09-17T03:00:00Z"
  }
}
```

---

### GET /api/overtime
List overtime requests.

**Auth:** Required

**Query params:** `status=pending&startDate=2026-09-01&endDate=2026-09-30`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "userId": 1,
      "date": "2026-09-17",
      "hours": 2,
      "reason": "Deploy hotfix",
      "status": "pending",
      "createdAt": "2026-09-17T03:00:00Z"
    }
  ]
}
```

---

### PUT /api/overtime/:id/approve
Approve an overtime request (manager+ only).

**Auth:** Required (`manager` or higher)

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "status": "approved", "approvedBy": 2, "approvedAt": "2026-09-17T03:00:00Z" }
}
```

---

### PUT /api/overtime/:id/reject
Reject an overtime request (manager+ only).

**Auth:** Required (`manager` or higher)

**Request body:**
```json
{ "reason": "Not approved" }
```

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "status": "rejected", "rejectedBy": 2, "rejectedAt": "2026-09-17T03:00:00Z", "rejectionReason": "Not approved" }
}
```

---

## 15. Work Schedules

### GET /api/work-schedules
List work schedules (manager+ only).

**Auth:** Required (`manager` or higher)

**Query params:** `departmentId=1&startDate=2026-09-01&endDate=2026-09-30`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "employeeId": 1,
      "date": "2026-09-17",
      "startTime": "09:00:00",
      "endTime": "17:00:00",
      "type": "regular"
    }
  ]
}
```

---

### GET /api/work-schedules/:employeeId
Get work schedule for a specific employee.

**Auth:** Required

**Query params:** `startDate=2026-09-01&endDate=2026-09-30`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "employeeId": 1,
      "date": "2026-09-17",
      "startTime": "09:00:00",
      "endTime": "17:00:00",
      "type": "regular"
    }
  ]
}
```

---

### POST /api/work-schedules
Create a work schedule (manager+ only).

**Auth:** Required (`manager` or higher)

**Request body:**
```json
{
  "employeeId": 1,
  "date": "2026-09-17",
  "startTime": "09:00:00",
  "endTime": "17:00:00",
  "type": "regular"
}
```

**Response 201:**
```json
{
  "success": true,
  "data": { "id": 1, "employeeId": 1, "date": "2026-09-17", "startTime": "09:00:00", "endTime": "17:00:00", "type": "regular" }
}
```

---

### PUT /api/work-schedules/:id
Update a work schedule (manager+ only).

**Auth:** Required (`manager` or higher)

**Request body:**
```json
{
  "startTime": "10:00:00",
  "endTime": "18:00:00"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "startTime": "10:00:00", "endTime": "18:00:00" }
}
```

---

### DELETE /api/work-schedules/:id
Delete a work schedule (manager+ only).

**Auth:** Required (`manager` or higher)

**Response 200:**
```json
{ "success": true, "message": "Work schedule deleted successfully" }
```

---

## 16. Leave Requests

### POST /api/leave-requests
Submit a leave request.

**Auth:** Required

**Request body:**
```json
{
  "type": "annual",
  "startDate": "2026-10-01",
  "endDate": "2026-10-05",
  "reason": "Family vacation"
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "userId": 1,
    "type": "annual",
    "startDate": "2026-10-01",
    "endDate": "2026-10-05",
    "reason": "Family vacation",
    "status": "pending",
    "createdAt": "2026-09-17T03:00:00Z"
  }
}
```

---

### GET /api/leave-requests
List leave requests.

**Auth:** Required

**Query params:** `status=pending&type=annual`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "userId": 1,
      "type": "annual",
      "startDate": "2026-10-01",
      "endDate": "2026-10-05",
      "status": "pending",
      "createdAt": "2026-09-17T03:00:00Z"
    }
  ]
}
```

---

### PUT /api/leave-requests/:id/approve
Approve a leave request (manager+ only).

**Auth:** Required (`manager` or higher)

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "status": "approved", "approvedBy": 2, "approvedAt": "2026-09-17T03:00:00Z" }
}
```

---

### PUT /api/leave-requests/:id/reject
Reject a leave request (manager+ only).

**Auth:** Required (`manager` or higher)

**Request body:**
```json
{ "reason": "Insufficient coverage" }
```

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "status": "rejected", "rejectedBy": 2, "rejectedAt": "2026-09-17T03:00:00Z", "rejectionReason": "Insufficient coverage" }
}
```

---

## 17. Holidays

### GET /api/holidays
List holidays.

**Auth:** Required

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "name": "New Year", "date": "2026-01-01", "type": "public", "companyId": 1 }
  ]
}
```

---

### POST /api/holidays
Create a holiday (manager+ only).

**Auth:** Required (`manager` or higher)

**Request body:**
```json
{
  "name": "Company Offsite",
  "date": "2026-12-25",
  "type": "company",
  "companyId": 1
}
```

**Response 201:**
```json
{
  "success": true,
  "data": { "id": 1, "name": "Company Offsite", "date": "2026-12-25", "type": "company", "companyId": 1 }
}
```

---

### PUT /api/holidays/:id
Update a holiday (manager+ only).

**Auth:** Required (`manager` or higher)

**Request body:**
```json
{ "name": "Updated Company Offsite" }
```

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "name": "Updated Company Offsite", "date": "2026-12-25" }
}
```

---

### DELETE /api/holidays/:id
Delete a holiday (manager+ only).

**Auth:** Required (`manager` or higher)

**Response 200:**
```json
{ "success": true, "message": "Holiday deleted successfully" }
```

---

## 18. Tasks

### GET /api/tasks
List tasks.

**Auth:** Required

**Query params:** `assignedTo=1&status=pending&conversationId=1`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "Fix login bug",
      "description": "Users cannot login with SSO",
      "status": "pending",
      "priority": "high",
      "assignedTo": 1,
      "createdBy": 2,
      "conversationId": 1,
      "dueDate": "2026-09-20T00:00:00Z",
      "createdAt": "2026-09-17T03:00:00Z"
    }
  ]
}
```

---

### POST /api/tasks
Create a task.

**Auth:** Required

**Request body:**
```json
{
  "title": "Fix login bug",
  "description": "Users cannot login with SSO",
  "status": "pending",
  "priority": "high",
  "assignedTo": 1,
  "conversationId": 1,
  "dueDate": "2026-09-20T00:00:00Z"
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "title": "Fix login bug",
    "description": "Users cannot login with SSO",
    "status": "pending",
    "priority": "high",
    "assignedTo": 1,
    "createdBy": 1,
    "conversationId": 1,
    "dueDate": "2026-09-20T00:00:00Z"
  }
}
```

---

### PATCH /api/tasks/:id
Update a task.

**Auth:** Required (assignee or creator, or manager+)

**Request body:**
```json
{ "status": "in_progress", "priority": "medium" }
```

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "status": "in_progress", "priority": "medium" }
}
```

---

### DELETE /api/tasks/:id
Delete a task.

**Auth:** Required (creator or manager+)

**Response 200:**
```json
{ "success": true, "message": "Task deleted successfully" }
```

---

### POST /api/tasks/:id/reactions
Add a reaction to a task.

**Auth:** Required

**Request body:**
```json
{ "reactionType": "👍" }
```

**Response 200:**
```json
{ "success": true, "message": "Reaction added" }
```

---

### DELETE /api/tasks/:id/reactions/:reactionType
Remove a reaction from a task.

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Reaction removed" }
```

---

### GET /api/tasks/:id/comments
List task comments.

**Auth:** Required

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "taskId": 1, "userId": 1, "content": "On it", "createdAt": "2026-09-17T03:00:00Z" }
  ]
}
```

---

### POST /api/tasks/:id/comments
Add a comment to a task.

**Auth:** Required

**Request body:**
```json
{ "content": "On it" }
```

**Response 201:**
```json
{
  "success": true,
  "data": { "id": 1, "taskId": 1, "userId": 1, "content": "On it", "createdAt": "2026-09-17T03:00:00Z" }
}
```

---

### DELETE /api/tasks/:id/comments/:commentId
Delete a task comment.

**Auth:** Required (comment author or task creator)

**Response 200:**
```json
{ "success": true, "message": "Comment deleted successfully" }
```

---

### GET /api/tasks/:id/attachments
List task attachments.

**Auth:** Required

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "taskId": 1, "fileName": "spec.pdf", "fileUrl": "/uploads/files/spec.pdf", "uploadedBy": 1 }
  ]
}
```

---

### POST /api/tasks/:id/attachments
Upload a task attachment.

**Auth:** Required

**Request:** `multipart/form-data` with `file` field

**Response 201:**
```json
{
  "success": true,
  "data": { "id": 1, "taskId": 1, "fileName": "spec.pdf", "fileUrl": "/uploads/files/spec.pdf", "uploadedBy": 1 }
}
```

---

### DELETE /api/tasks/:id/attachments/:attachmentId
Delete a task attachment.

**Auth:** Required (uploader or task creator)

**Response 200:**
```json
{ "success": true, "message": "Attachment deleted successfully" }
```

---

## 19. Shared Files

### POST /api/shared-files/upload
Upload a shared file.

**Auth:** Required

**Request:** `multipart/form-data` with `file` field and optional `conversationId`, `teamId`, `channelId`

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "fileName": "document.pdf",
    "fileUrl": "/uploads/files/document-1234567890.pdf",
    "fileSize": 102400,
    "mimeType": "application/pdf",
    "uploadedBy": 1,
    "conversationId": 1
  }
}
```

---

### GET /api/shared-files
List shared files.

**Auth:** Required

**Query params:** `conversationId=1&teamId=1&channelId=1&limit=20`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "fileName": "document.pdf",
      "fileUrl": "/uploads/files/document-1234567890.pdf",
      "fileSize": 102400,
      "mimeType": "application/pdf",
      "uploadedBy": 1,
      "conversationId": 1,
      "createdAt": "2026-09-17T03:00:00Z"
    }
  ]
}
```

---

### GET /api/shared-files/team/:teamId
List files shared in a team.

**Auth:** Required (team member)

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "fileName": "document.pdf", "fileUrl": "/uploads/files/document.pdf", "uploadedBy": 1 }
  ]
}
```

---

### GET /api/shared-files/search
Search shared files.

**Auth:** Required

**Query params:** `q=document&limit=20`

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "fileName": "document.pdf", "fileUrl": "/uploads/files/document.pdf" }
  ]
}
```

---

### GET /api/shared-files/:id
Get a specific shared file.

**Auth:** Required (must have access)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "fileName": "document.pdf",
    "fileUrl": "/uploads/files/document.pdf",
    "fileSize": 102400,
    "mimeType": "application/pdf",
    "uploadedBy": 1,
    "conversationId": 1
  }
}
```

---

### PATCH /api/shared-files/:id
Update shared file metadata.

**Auth:** Required (uploader or admin+)

**Request body:**
```json
{ "fileName": "updated-document.pdf" }
```

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "fileName": "updated-document.pdf" }
}
```

---

### DELETE /api/shared-files/:id
Delete a shared file.

**Auth:** Required (uploader or admin+)

**Response 200:**
```json
{ "success": true, "message": "File deleted successfully" }
```

---

### GET /api/shared-files/:id/download
Download a shared file.

**Auth:** Required (must have access)

**Response 200:** Binary file stream with `Content-Disposition` header

---

### POST /api/shared-files/:id/embed
Generate an embed preview URL for a file.

**Auth:** Required

**Response 200:**
```json
{
  "success": true,
  "data": { "embedUrl": "https://storage.example.com/embed/document.pdf" }
}
```

---

### GET /api/shared-files/:id/shares
List file shares.

**Auth:** Required (uploader or admin+)

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "fileId": 1, "userId": 2, "permission": "read", "sharedBy": 1, "createdAt": "2026-09-17T03:00:00Z" }
  ]
}
```

---

### POST /api/shared-files/:id/shares
Share a file with a user.

**Auth:** Required (uploader or admin+)

**Request body:**
```json
{ "userId": 2, "permission": "read" }
```

**Response 201:**
```json
{
  "success": true,
  "data": { "id": 1, "fileId": 1, "userId": 2, "permission": "read", "sharedBy": 1 }
}
```

---

### DELETE /api/shared-files/:id/shares/:shareId
Unshare a file.

**Auth:** Required (uploader or admin+)

**Response 200:**
```json
{ "success": true, "message": "File unshared successfully" }
```

---

### POST /api/shared-files/:id/versions
Upload a new version of a file.

**Auth:** Required (uploader or admin+)

**Request:** `multipart/form-data` with `file` field

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": 2,
    "fileId": 1,
    "version": 2,
    "fileName": "document-v2.pdf",
    "fileUrl": "/uploads/files/document-v2.pdf",
    "uploadedBy": 1
  }
}
```

---

### GET /api/shared-files/:id/versions
List file versions.

**Auth:** Required (must have access)

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "fileId": 1, "version": 1, "fileName": "document.pdf", "uploadedBy": 1, "createdAt": "2026-09-17T03:00:00Z" },
    { "id": 2, "fileId": 1, "version": 2, "fileName": "document-v2.pdf", "uploadedBy": 1, "createdAt": "2026-09-17T04:00:00Z" }
  ]
}
```

---

### GET /api/shared-files/:id/permissions
List file permissions.

**Auth:** Required (uploader or admin+)

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "fileId": 1, "userId": 2, "permission": "read", "grantedBy": 1 }
  ]
}
```

---

### POST /api/shared-files/:id/permissions
Grant a file permission.

**Auth:** Required (uploader or admin+)

**Request body:**
```json
{ "userId": 2, "permission": "write" }
```

**Response 201:**
```json
{
  "success": true,
  "data": { "id": 1, "fileId": 1, "userId": 2, "permission": "write", "grantedBy": 1 }
}
```

---

### DELETE /api/shared-files/:id/permissions/:userId
Revoke a file permission.

**Auth:** Required (uploader or admin+)

**Response 200:**
```json
{ "success": true, "message": "Permission revoked successfully" }
```

---

## 20. Bookmarks

### POST /api/messages/:id/bookmarks
Bookmark a message.

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Message bookmarked" }
```

---

### DELETE /api/messages/:id/bookmarks
Remove a message bookmark.

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Bookmark removed" }
```

---

### GET /api/bookmarks
List bookmarked messages.

**Auth:** Required

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "messageId": 1,
      "userId": 1,
      "message": {
        "id": 1,
        "conversationId": 1,
        "senderId": 1,
        "content": "Hello, world!",
        "createdAt": "2026-09-17T03:00:00Z"
      },
      "createdAt": "2026-09-17T03:00:00Z"
    }
  ]
}
```

---

## 21. Reminders

### POST /api/messages/:id/remind
Set a reminder for a message.

**Auth:** Required

**Request body:**
```json
{ "remindAt": "2026-09-17T12:00:00Z" }
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "userId": 1,
    "messageId": 1,
    "remindAt": "2026-09-17T12:00:00Z",
    "createdAt": "2026-09-17T03:00:00Z"
  }
}
```

---

### DELETE /api/messages/:id/remind
Cancel a message reminder.

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Reminder cancelled" }
```

---

### GET /api/messages/:id/remind
Get a message reminder.

**Auth:** Required

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "userId": 1,
    "messageId": 1,
    "remindAt": "2026-09-17T12:00:00Z",
    "createdAt": "2026-09-17T03:00:00Z"
  }
}
```

---

## 22. Settings

### GET /api/settings/public
Get public system settings (no auth required).

**Auth:** None

**Response 200:**
```json
{
  "success": true,
  "data": {
    "maintenanceMode": false,
    "registrationEnabled": true,
    "defaultCompanyId": 1
  }
}
```

---

### GET /api/settings
Get all system settings (super_admin only).

**Auth:** Required (`super_admin`)

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "key": "maintenance_mode", "value": "false", "type": "boolean", "description": "Enable maintenance mode" }
  ]
}
```

---

### PATCH /api/settings
Update system settings (super_admin only).

**Auth:** Required (`super_admin`)

**Request body:**
```json
{ "maintenance_mode": true }
```

**Response 200:**
```json
{
  "success": true,
  "data": { "key": "maintenance_mode", "value": "true" }
}
```

---

## 23. Company Settings

### GET /api/company-settings
Get company settings (admin+ only).

**Auth:** Required (`admin` or higher)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "companyId": 1,
    "name": "Acme Corp",
    "domain": "acme.com",
    "allowRegistration": true,
    "defaultRole": "employee"
  }
}
```

---

### PATCH /api/company-settings
Update company settings (admin+ only).

**Auth:** Required (`admin` or higher)

**Request body:**
```json
{
  "name": "Acme Corp",
  "allowRegistration": false,
  "defaultRole": "employee"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": { "companyId": 1, "name": "Acme Corp", "allowRegistration": false }
}
```

---

### GET /api/company-settings/permissions
Get company permission settings (admin+ only).

**Auth:** Required (`admin` or higher)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "allowFileUploads": true,
    "allowVideoCalls": true,
    "maxFileSize": 10485760,
    "allowedFileTypes": ["pdf", "doc", "jpg", "png"]
  }
}
```

---

### PATCH /api/company-settings/permissions
Update company permission settings (admin+ only).

**Auth:** Required (`admin` or higher)

**Request body:**
```json
{
  "allowFileUploads": true,
  "allowVideoCalls": true,
  "maxFileSize": 20971520
}
```

**Response 200:**
```json
{
  "success": true,
  "data": { "allowFileUploads": true, "allowVideoCalls": true, "maxFileSize": 20971520 }
}
```

---

### GET /api/company-settings/plan
Get company subscription plan (admin+ only).

**Auth:** Required (`admin` or higher)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "planId": 1,
    "planName": "Pro",
    "maxUsers": 100,
    "maxStorage": 10737418240,
    "features": ["video_calls", "file_sharing", "api_access"]
  }
}
```

---

## 24. Audit Logs

### GET /api/audit-logs
List audit logs (admin+ only).

**Auth:** Required (`admin` or higher)

**Query params:** `userId=1&action=user.create&startDate=2026-09-01&endDate=2026-09-30&limit=50`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "userId": 1,
      "action": "user.create",
      "resourceType": "user",
      "resourceId": 2,
      "details": { "email": "newuser@example.com" },
      "ip": "192.168.1.1",
      "createdAt": "2026-09-17T03:00:00Z"
    }
  ]
}
```

---

### GET /api/audit-logs/platform
List platform-wide audit logs (super_admin only).

**Auth:** Required (`super_admin`)

**Query params:** `companyId=1&action=company.update&startDate=2026-09-01&endDate=2026-09-30`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "userId": 1,
      "companyId": 1,
      "action": "company.update",
      "resourceType": "company",
      "resourceId": 1,
      "details": { "name": "Acme Corp" },
      "ip": "192.168.1.1",
      "createdAt": "2026-09-17T03:00:00Z"
    }
  ]
}
```

---

## 25. Subscriptions

### GET /api/subscriptions
List subscription plans (super_admin only).

**Auth:** Required (`super_admin`)

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Pro",
      "price": 29.99,
      "currency": "USD",
      "interval": "monthly",
      "maxUsers": 100,
      "maxStorage": 10737418240,
      "features": ["video_calls", "file_sharing", "api_access"]
    }
  ]
}
```

---

### PATCH /api/subscriptions/:id
Update a subscription plan (super_admin only).

**Auth:** Required (`super_admin`)

**Request body:**
```json
{
  "price": 39.99,
  "maxUsers": 200
}
```

**Response 200:**
```json
{
  "success": true,
  "data": { "id": 1, "name": "Pro", "price": 39.99, "maxUsers": 200 }
}
```

---

## 26. Platform Metrics

### GET /api/admin/metrics
Get platform metrics (super_admin only).

**Auth:** Required (`super_admin`)

**Query params:** `period=7d`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "totalUsers": 1000,
    "activeUsers": 450,
    "totalMessages": 50000,
    "totalCompanies": 50,
    "growth": { "users": 5.2, "messages": 12.1 }
  }
}
```

---

## 27. Notification Preferences

### GET /api/notification-preferences
Get the current user's notification preferences.

**Auth:** Required

**Response 200:**
```json
{
  "success": true,
  "data": {
    "userId": 1,
    "email": true,
    "push": true,
    "desktop": true,
    "categories": {
      "messages": true,
      "mentions": true,
      "tasks": true,
      "announcements": true,
      "calls": true
    }
  }
}
```

---

### PUT /api/notification-preferences
Update the current user's notification preferences.

**Auth:** Required

**Request body:**
```json
{
  "email": true,
  "push": false,
  "desktop": true,
  "categories": {
    "messages": true,
    "mentions": true,
    "tasks": false,
    "announcements": true,
    "calls": true
  }
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "userId": 1,
    "email": true,
    "push": false,
    "desktop": true,
    "categories": {
      "messages": true,
      "mentions": true,
      "tasks": false,
      "announcements": true,
      "calls": true
    }
  }
}
```

---

## 28. Telegram Integration

### POST /api/telegram/webhook
Telegram webhook endpoint (public).

**Auth:** None (validated via `X-Telegram-Bot-Api-Secret-Token`)

**Request body:** Telegram update payload

**Response 200:** `{ "ok": true }`

---

### GET /api/telegram/health
Telegram integration health check (public).

**Auth:** None

**Response 200:**
```json
{
  "success": true,
  "data": { "connected": true, "botUsername": "kneachat_bot" }
}
```

---

### POST /api/telegram/messages
Send a message to a Telegram conversation.

**Auth:** Required

**Request body:**
```json
{
  "conversationId": 1,
  "content": "Hello from KneaChat"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "messageId": 123,
    "chatId": "456",
    "text": "Hello from KneaChat"
  }
}
```

---

### POST /api/telegram/conversations/:id/assign
Assign an agent to a Telegram conversation.

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Agent assigned to conversation" }
```

---

### DELETE /api/telegram/conversations/:id/assign
Unassign an agent from a Telegram conversation.

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Agent unassigned from conversation" }
```

---

### POST /api/telegram/setup-webhook
Set the Telegram webhook URL (admin+ only).

**Auth:** Required (`admin` or higher)

**Request body:**
```json
{ "webhookUrl": "https://example.com/api/telegram/webhook" }
```

**Response 200:**
```json
{
  "success": true,
  "data": { "webhookUrl": "https://example.com/api/telegram/webhook", "pendingUpdateCount": 0 }
}
```

---

### GET /api/telegram/webhook-info
Get current webhook info (admin+ only).

**Auth:** Required (`admin` or higher)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "url": "https://example.com/api/telegram/webhook",
    "hasCustomCertificate": false,
    "pendingUpdateCount": 0,
    "lastErrorDate": null,
    "lastErrorMessage": null
  }
}
```

---

### DELETE /api/telegram/webhook
Delete the Telegram webhook (admin+ only).

**Auth:** Required (`admin` or higher)

**Response 200:**
```json
{
  "success": true,
  "data": { "url": "", "pendingUpdateCount": 0 }
}
```

---

## 29. Website Integration

### POST /api/website/webhook
Website chat webhook endpoint (public).

**Auth:** None

**Request body:** Website chat event payload

**Response 200:** `{ "ok": true }`

---

### GET /api/website/health
Website integration health check (public).

**Auth:** None

**Response 200:**
```json
{
  "success": true,
  "data": { "connected": true }
}
```

---

### POST /api/website/messages
Send a message to a website conversation.

**Auth:** Required

**Request body:**
```json
{
  "conversationId": 1,
  "content": "Hello from KneaChat"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "messageId": 1,
    "conversationId": 1,
    "content": "Hello from KneaChat"
  }
}
```

---

### POST /api/website/conversations/:id/assign
Assign an agent to a website conversation.

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Agent assigned to conversation" }
```

---

### DELETE /api/website/conversations/:id/assign
Unassign an agent from a website conversation.

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Agent unassigned from conversation" }
```

---

## 30. Omni-Channel

### GET /api/omni/health/:channel
Health check for an omni-channel.

**Auth:** None

**Path params:** `channel=telegram|website`

**Response 200:**
```json
{
  "success": true,
  "data": { "channel": "telegram", "connected": true }
}
```

---

### GET /api/omni/capabilities
Get omni-channel capabilities (public).

**Auth:** None

**Response 200:**
```json
{
  "success": true,
  "data": {
    "channels": ["telegram", "website"],
    "actions": ["assign", "unassign", "setStatus", "sendMessage", "sendMedia"]
  }
}
```

---

### POST /api/omni/conversations/:id/assign
Assign an agent to an omni-channel conversation.

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Agent assigned to conversation" }
```

---

### DELETE /api/omni/conversations/:id/assign
Unassign an agent from an omni-channel conversation.

**Auth:** Required

**Response 200:**
```json
{ "success": true, "message": "Agent unassigned from conversation" }
```

---

### PATCH /api/omni/conversations/:id/status
Set the status of an omni-channel conversation.

**Auth:** Required

**Request body:**
```json
{ "status": "open" }
```

**Response 200:**
```json
{
  "success": true,
  "data": { "conversationId": 1, "status": "open" }
}
```

---

### POST /api/omni/conversations/:id/messages
Send a message to an omni-channel conversation.

**Auth:** Required

**Request body:**
```json
{ "content": "Hello from KneaChat" }
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "messageId": 1,
    "conversationId": 1,
    "content": "Hello from KneaChat"
  }
}
```

---

### POST /api/omni/conversations/:id/media
Send media to an omni-channel conversation.

**Auth:** Required

**Request:** `multipart/form-data` with `file` field

**Response 200:**
```json
{
  "success": true,
  "data": {
    "messageId": 1,
    "conversationId": 1,
    "mediaUrl": "/uploads/files/media-1234567890.png",
    "mimeType": "image/png"
  }
}
```

---

## 31. WebSocket Events

Connect to `ws://localhost:8080` with `?token=<JWT>` in the query string.

### Connection Events

#### Server → Client: `connection_ack`
Sent when the WebSocket connection is authenticated successfully.

```json
{
  "type": "connection_ack",
  "message": "Connected to KneaChat WebSocket server",
  "userId": 1,
  "timestamp": "2026-09-17T03:00:00Z"
}
```

---

#### Server → Client: `presence_snapshot`
Sent on connect to inform the client of currently online users.

```json
{
  "type": "presence_snapshot",
  "data": {
    "userIds": [1, 2, 3],
    "timestamp": "2026-09-17T03:00:00Z"
  }
}
```

---

### Messaging Events

#### Client → Server: `send_message`
Send a message to a conversation.

**Request:**
```json
{
  "type": "send_message",
  "conversationId": 1,
  "content": "Hello, world!",
  "replyTo": null
}
```

#### Server → Client: `receive_message`
Broadcast to conversation members when a message is sent.

```json
{
  "type": "receive_message",
  "message": {
    "id": 1,
    "conversationId": 1,
    "senderId": 1,
    "content": "Hello, world!",
    "type": "text",
    "createdAt": "2026-09-17T03:00:00Z"
  }
}
```

#### Server → Client: `message_sent_ack`
Acknowledgment to the sender.

```json
{
  "type": "message_sent_ack",
  "message": "Message sent successfully",
  "data": { "id": 1, "content": "Hello, world!" },
  "timestamp": "2026-09-17T03:00:00Z"
}
```

---

#### Client → Server: `forward_message`
Forward a message to another conversation.

**Request:**
```json
{
  "type": "forward_message",
  "messageId": 1,
  "targetConversationId": 2
}
```

#### Server → Client: `message_forwarded`
Broadcast to the target conversation.

```json
{
  "type": "message_forwarded",
  "message": {
    "id": 2,
    "conversationId": 2,
    "senderId": 1,
    "content": "Hello, world!",
    "type": "text",
    "createdAt": "2026-09-17T03:00:00Z"
  }
}
```

#### Server → Client: `message_forwarded_ack`
Acknowledgment to the sender.

```json
{
  "type": "message_forwarded_ack",
  "messageId": 1,
  "targetConversationId": 2,
  "timestamp": "2026-09-17T03:00:00Z"
}
```

---

#### Client → Server: `message_edited`
Edit a message.

**Request:**
```json
{
  "type": "message_edited",
  "messageId": 1,
  "content": "Updated content"
}
```

#### Server → Client: `message_updated`
Broadcast to conversation members.

```json
{
  "type": "message_updated",
  "message": {
    "id": 1,
    "conversationId": 1,
    "content": "Updated content",
    "updatedAt": "2026-09-17T03:05:00Z"
  }
}
```

#### Server → Client: `message_edited_ack`
Acknowledgment to the sender.

```json
{
  "type": "message_edited_ack",
  "messageId": 1,
  "timestamp": "2026-09-17T03:05:00Z"
}
```

---

#### Client → Server: `message_deleted`
Delete a message.

**Request:**
```json
{
  "type": "message_deleted",
  "messageId": 1
}
```

#### Server → Client: `message_deleted`
Broadcast to conversation members.

```json
{
  "type": "message_deleted",
  "message": {
    "id": 1,
    "conversationId": 1,
    "deletedAt": "2026-09-17T03:05:00Z"
  }
}
```

#### Server → Client: `message_deleted_ack`
Acknowledgment to the sender.

```json
{
  "type": "message_deleted_ack",
  "messageId": 1,
  "timestamp": "2026-09-17T03:05:00Z"
}
```

---

#### Client → Server: `message_pinned`
Pin a message.

**Request:**
```json
{
  "type": "message_pinned",
  "messageId": 1
}
```

#### Server → Client: `message_pinned`
Broadcast to conversation members.

```json
{
  "type": "message_pinned",
  "message": {
    "id": 1,
    "conversationId": 1,
    "isPinned": true
  }
}
```

#### Server → Client: `message_pinned_ack`
Acknowledgment to the sender.

```json
{
  "type": "message_pinned_ack",
  "messageId": 1,
  "timestamp": "2026-09-17T03:05:00Z"
}
```

---

#### Client → Server: `message_unpinned`
Unpin a message.

**Request:**
```json
{
  "type": "message_unpinned",
  "messageId": 1
}
```

#### Server → Client: `message_unpinned`
Broadcast to conversation members.

```json
{
  "type": "message_unpinned",
  "message": {
    "id": 1,
    "conversationId": 1,
    "isPinned": false
  }
}
```

#### Server → Client: `message_unpinned_ack`
Acknowledgment to the sender.

```json
{
  "type": "message_unpinned_ack",
  "messageId": 1,
  "timestamp": "2026-09-17T03:05:00Z"
}
```

---

### Presence Events

#### Client → Server: `user_status`
Update the current user's status.

**Request:**
```json
{
  "type": "user_status",
  "status": "online"
}
```

Valid statuses: `online`, `offline`, `away`, `dnd`

#### Server → Client: `user_status_changed`
Broadcast to all connected clients.

```json
{
  "type": "user_status_changed",
  "data": {
    "userId": 1,
    "userEmail": "user@example.com",
    "status": "online",
    "timestamp": "2026-09-17T03:00:00Z"
  }
}
```

---

#### Server → Client: `user_online`
Broadcast when a user connects.

```json
{
  "type": "user_online",
  "data": {
    "userId": 1,
    "userEmail": "user@example.com",
    "timestamp": "2026-09-17T03:00:00Z"
  }
}
```

---

#### Server → Client: `user_offline`
Broadcast when a user disconnects.

```json
{
  "type": "user_offline",
  "data": {
    "userId": 1,
    "userEmail": "user@example.com",
    "timestamp": "2026-09-17T03:00:00Z"
  }
}
```

---

### Typing Events

#### Client → Server: `typing_start`
Indicate the user started typing.

**Request:**
```json
{
  "type": "typing_start",
  "conversationId": 1
}
```

#### Server → Client: `typing_start`
Broadcast to other conversation members.

```json
{
  "type": "typing_start",
  "data": {
    "conversationId": 1,
    "userId": 1,
    "userEmail": "user@example.com",
    "timestamp": "2026-09-17T03:00:00Z"
  }
}
```

---

#### Client → Server: `typing_stop`
Indicate the user stopped typing.

**Request:**
```json
{
  "type": "typing_stop",
  "conversationId": 1
}
```

#### Server → Client: `typing_stop`
Broadcast to other conversation members.

```json
{
  "type": "typing_stop",
  "data": {
    "conversationId": 1,
    "userId": 1,
    "userEmail": "user@example.com",
    "timestamp": "2026-09-17T03:00:00Z"
  }
}
```

---

### Channel Events

#### Client → Server: `join_channel`
Join a channel/conversation.

**Request:**
```json
{
  "type": "join_channel",
  "channelId": 1
}
```

#### Server → Client: `joined_channel`
Confirmation to the client.

```json
{
  "type": "joined_channel",
  "channelId": 1,
  "timestamp": "2026-09-17T03:00:00Z"
}
```

---

#### Client → Server: `leave_channel`
Leave a channel/conversation.

**Request:**
```json
{
  "type": "leave_channel",
  "channelId": 1
}
```

#### Server → Client: `left_channel`
Confirmation to the client.

```json
{
  "type": "left_channel",
  "channelId": 1,
  "timestamp": "2026-09-17T03:00:00Z"
}
```

---

### Call Events (Voice/Video + WebRTC)

#### Client → Server: `call_start`
Initiate a call.

**Request:**
```json
{
  "type": "call_start",
  "callId": "call-123",
  "targetId": 2,
  "targetType": "user",
  "mediaType": "voice"
}
```

#### Server → Client: `incoming_call`
Sent to the callee.

```json
{
  "type": "incoming_call",
  "data": {
    "callId": "call-123",
    "callerUserId": 1,
    "callerName": "John Doe",
    "callerStatus": "online",
    "type": "voice",
    "isGroup": false
  },
  "timestamp": "2026-09-17T03:00:00Z"
}
```

---

#### Client → Server: `call_accept`
Accept a call.

**Request:**
```json
{
  "type": "call_accept",
  "callId": "call-123",
  "callerUserId": 1
}
```

#### Server → Client: `call_accepted`
Sent to the caller.

```json
{
  "type": "call_accepted",
  "data": {
    "callId": "call-123",
    "calleeUserId": 2,
    "calleeName": "Jane Doe"
  },
  "timestamp": "2026-09-17T03:00:00Z"
}
```

---

#### Client → Server: `call_decline`
Decline a call.

**Request:**
```json
{
  "type": "call_decline",
  "callId": "call-123",
  "callerUserId": 1
}
```

#### Server → Client: `call_declined`
Sent to the caller.

```json
{
  "type": "call_declined",
  "data": {
    "callId": "call-123",
    "calleeUserId": 2,
    "calleeName": "Jane Doe"
  },
  "timestamp": "2026-09-17T03:00:00Z"
}
```

---

#### Client → Server: `call_end`
End a call.

**Request:**
```json
{
  "type": "call_end",
  "callId": "call-123",
  "targetId": 2,
  "targetType": "user"
}
```

#### Server → Client: `call_ended`
Sent to the other participant(s).

```json
{
  "type": "call_ended",
  "data": {
    "callId": "call-123"
  },
  "timestamp": "2026-09-17T03:00:00Z"
}
```

---

#### Server → Client: `call_unavailable`
Sent to the caller when the callee is offline.

```json
{
  "type": "call_unavailable",
  "data": {
    "callId": "call-123"
  },
  "timestamp": "2026-09-17T03:00:00Z"
}
```

---

#### Server → Client: `call_participants`
Sent when the participant list changes.

```json
{
  "type": "call_participants",
  "data": {
    "callId": "call-123",
    "participants": [
      { "userId": 1, "name": "John Doe", "isCaller": true },
      { "userId": 2, "name": "Jane Doe", "isCaller": false }
    ]
  },
  "timestamp": "2026-09-17T03:00:00Z"
}
```

---

#### Client → Server: `webrtc_offer`
Send an SDP offer.

**Request:**
```json
{
  "type": "webrtc_offer",
  "callId": "call-123",
  "targetUserId": 2,
  "sdp": { "type": "offer", "sdp": "..." }
}
```

#### Server → Client: `webrtc_offer`
Relayed to the target user.

```json
{
  "type": "webrtc_offer",
  "data": {
    "callId": "call-123",
    "targetUserId": 1,
    "sdp": { "type": "offer", "sdp": "..." }
  },
  "timestamp": "2026-09-17T03:00:00Z"
}
```

---

#### Client → Server: `webrtc_answer`
Send an SDP answer.

**Request:**
```json
{
  "type": "webrtc_answer",
  "callId": "call-123",
  "targetUserId": 1,
  "sdp": { "type": "answer", "sdp": "..." }
}
```

#### Server → Client: `webrtc_answer`
Relayed to the target user.

```json
{
  "type": "webrtc_answer",
  "data": {
    "callId": "call-123",
    "targetUserId": 1,
    "sdp": { "type": "answer", "sdp": "..." }
  },
  "timestamp": "2026-09-17T03:00:00Z"
}
```

---

#### Client → Server: `webrtc_ice`
Send an ICE candidate.

**Request:**
```json
{
  "type": "webrtc_ice",
  "callId": "call-123",
  "targetUserId": 2,
  "candidate": { "candidate": "...", "sdpMid": "0", "sdpMLineIndex": 0 }
}
```

#### Server → Client: `webrtc_ice`
Relayed to the target user.

```json
{
  "type": "webrtc_ice",
  "data": {
    "callId": "call-123",
    "targetUserId": 2,
    "candidate": { "candidate": "...", "sdpMid": "0", "sdpMLineIndex": 0 }
  },
  "timestamp": "2026-09-17T03:00:00Z"
}
```

---

### Notification Events

#### Server → Client: `notification`
Push a live notification to a user.

```json
{
  "type": "notification",
  "data": {
    "type": "new_message",
    "title": "John Doe",
    "message": "Hello, world!",
    "conversationId": 1,
    "messageId": 1
  }
}
```

Other notification types: `mention`, `missed_call`, `task_assigned`, `announcement`

---

### Workspace Events

#### Server → Client: `workspace_changed`
Notify clients to refresh a workspace collection.

```json
{
  "type": "workspace_changed",
  "data": {
    "kind": "teams"
  },
  "timestamp": "2026-09-17T03:00:00Z"
}
```

`kind` values: `teams`, `channels`

---

### Attendance Events

#### Server → Client: `attendance_updated`
Broadcast attendance changes to company-connected clients.

```json
{
  "type": "attendance_updated",
  "data": {
    "userId": 1,
    "status": "present",
    "clockIn": "2026-09-17T09:00:00Z",
    "clockOut": "2026-09-17T17:00:00Z"
  },
  "timestamp": "2026-09-17T03:00:00Z",
  "origin": "instance-1"
}
```

---

### Utility Events

#### Client → Server: `ping`
Keepalive ping.

**Request:**
```json
{ "type": "ping" }
```

#### Server → Client: `pong`
Keepalive pong.

```json
{
  "type": "pong",
  "timestamp": "2026-09-17T03:00:00Z"
}
```

---

#### Server → Client: `error`
Generic error response.

```json
{
  "type": "error",
  "message": "Missing required field: conversationId"
}
```

---

## Error Responses

All endpoints return errors in the following format:

```json
{
  "success": false,
  "message": "Error description",
  "errors": [
    { "field": "email", "message": "Email is required" }
  ]
}
```

### Common HTTP Status Codes

| Status | Meaning |
| ------ | ------- |
| 200 | Success |
| 201 | Created |
| 400 | Bad Request — validation error |
| 401 | Unauthorized — missing or invalid JWT |
| 403 | Forbidden — insufficient permissions |
| 404 | Not Found |
| 429 | Too Many Requests — rate limited |
| 500 | Internal Server Error |
