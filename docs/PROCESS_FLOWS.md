# KneaChat — Complete Feature Process Flows

> **Project:** KneaChat — Real-time workplace communication platform  
> **Generated:** 2026-09-14  
> **Purpose:** Detailed step-by-step process flows for every feature in the system

---

## Table of Contents

1. [Authentication & Authorization](#1-authentication--authorization)
2. [User Management](#2-user-management)
3. [Team Management](#3-team-management)
4. [Channel Management](#4-channel-management)
5. [Conversation Management](#5-conversation-management)
6. [Messaging](#6-messaging)
7. [Message Reactions](#7-message-reactions)
8. [Message Pinning](#8-message-pinning)
9. [Message Forwarding](#9-message-forwarding)
10. [Message Reminders](#10-message-reminders)
11. [Message Bookmarks](#11-message-bookmarks)
12. [File Sharing](#12-file-sharing)
13. [Shared Files](#13-shared-files)
14. [Meetings](#14-meetings)
15. [Tasks](#15-tasks)
16. [Announcements](#16-announcements)
17. [Notifications](#17-notifications)
18. [Attendance](#18-attendance)
19. [Leave Management](#19-leave-management)
20. [Holidays](#20-holidays)
21. [Work Schedules](#21-work-schedules)
22. [Overtime](#22-overtime)
23. [Calls (Voice/Video)](#23-calls-voicevideo)
24. [Presence & Typing](#24-presence--typing)
25. [Search](#25-search)
26. [Omni-Channel (Telegram)](#26-omni-channel-telegram)
27. [Omni-Channel (Website Widget)](#27-omni-channel-website-widget)
28. [Administration & Permissions](#28-administration--permissions)
29. [Background Schedulers](#29-background-schedulers)
30. [WebSocket Real-Time Pipeline](#30-websocket-real-time-pipeline)

---

## 1. Authentication & Authorization

### 1.1 User Registration

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/auth/register -------->|
  |   { firstName, lastName,           |
  |     email, password }              |
  |                                    |
  |                         [AuthController.register]
  |                         [AuthService.register]
  |                             |-- Validate input (required fields)
  |                             |-- Check email uniqueness
  |                             |-- Check platform max_users_per_org
  |                             |-- Check subscription seat limit
  |                             |-- Hash password (bcrypt, salt rounds=10)
  |                             |-- Create user (role='employee')
  |                             |     [userRepository.create]
  |                             |-- Auto-login after registration
  |                             |     [AuthService.login]
  |                             |     |-- Verify credentials
  |                             |     |-- Generate JWT (id, email, role, companyId, jti)
  |                             |     |-- Create session record
  |                             |     |     [sessionRepository.createSession]
  |                             |     |-- Update user status → online
  |                             |     |     [userRepository.updateStatus]
  |                             |     |-- Return { user, token, expiresIn }
  |                             |
  |<-- 200 OK { user, token } --------|
  |                                    |
  |-- Connect WebSocket --------------|
  |   ws://host?token=<JWT>            |
  |                                    |
```

**Key Points:**
- New users get `role='employee'` by default
- Auto-assigned to `kneachat.com` domain company
- Platform enforces `max_users_per_org` limit (0 = unlimited)
- Subscription plan seat limits enforced via `SubscriptionService.assertCanAddUser()`

### 1.2 User Login

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/auth/login ----------->|
  |   { email, password }              |
  |                                    |
  |                         [AuthService.login]
  |                             |-- Find user by email
  |                             |-- Check is_active
  |                             |-- Verify bcrypt password
  |                             |-- Generate JWT payload:
  |                             |     { id, email, role, companyId, jti }
  |                             |-- Sign JWT (expires: 24h)
  |                             |-- Hash token (SHA-256) for session tracking
  |                             |-- Create session record
  |                             |     [sessionRepository.createSession]
  |                             |-- Update user status → online
  |                             |-- Return { user, token, expiresIn }
  |                                    |
  |<-- 200 OK { user, token } --------|
  |                                    |
  |-- Store token (localStorage)       |
  |-- Connect WebSocket --------------|
  |   ws://host?token=<JWT>            |
  |                                    |
```

**Key Points:**
- JWT includes `jti` (UUID) for unique token per session
- Token hash stored for session tracking
- User status set to `online` on login

### 1.3 Token Refresh

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/auth/refresh --------->|
  |   (auto, with current token)       |
  |                                    |
  |                         [AuthService.refreshToken]
  |                             |-- Verify user exists + is_active
  |                             |-- Generate new JWT (new jti)
  |                             |-- Return { token, expiresIn }
  |                                    |
  |<-- 200 OK { token } -------------|
  |                                    |
  |-- Update stored token              |
  |-- Reconnect WebSocket --------------|
  |   ws://host?token=<NEW_JWT>        |
  |                                    |
```

### 1.4 Password Reset Flow

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/auth/forgot-password ->|
  |   { email }                        |
  |                                    |
  |                         [AuthService.forgotPassword]
  |                             |-- Find user by email
  |                             |-- Generate UUID reset token
  |                             |-- Set expiry (1 hour)
  |                             |-- Store in password_resets table
  |                             |-- Create notification
  |                             |     [notificationRepository.create]
  |                             |-- Return { message }
  |                                    |
  |<-- 200 OK { message } -----------|
  |                                    |
  | (User clicks reset link with token)
  |                                    |
  |-- POST /api/auth/reset-password -->|
  |   { token, newPassword }           |
  |                                    |
  |                         [AuthService.resetPassword]
  |                             |-- Find valid reset token
  |                             |-- Check expiry
  |                             |-- Hash new password (bcrypt)
  |                             |-- Update user password
  |                             |-- Mark reset token as used
  |                             |-- Return { message }
  |                                    |
  |<-- 200 OK { message } -----------|
  |                                    |
```

### 1.5 JWT Authentication (REST)

```
CLIENT                              SERVER
  |                                    |
  |-- GET /api/messages               |
  |   Authorization: Bearer <token>    |
  |                                    |
  |                         [auth.authenticate]
  |                             |-- Extract token from header
  |                             |-- Verify JWT signature
  |                             |-- Check expiry
  |                             |-- Attach user to req.user
  |                             |     { id, email, role, companyId }
  |                             |-- Check maintenance mode
  |                             |     (blocks non-super_admin)
  |                             |-- Call next()
  |                                    |
  |                         [Route handler]
  |                                    |
  |<-- 200 OK { messages } ----------|
  |                                    |
```

**Error Cases:**
- `401 Unauthorized` — No token / invalid token / expired token
- `503 Maintenance` — Platform in maintenance mode

### 1.6 JWT Authentication (WebSocket)

```
CLIENT                              SERVER
  |                                    |
  |-- ws://host?token=<JWT> ---------->|
  |                                    |
  |                         [ChatWebSocketServer]
  |                             |-- Extract token from query params
  |                             |-- Verify JWT signature
  |                             |-- Attach to socket:
  |                             |     socket.userId, socket.email,
  |                             |     socket.role, socket.companyId
  |                             |-- Register in userConnections Map
  |                             |-- Send connection_ack
  |                             |-- Broadcast user_online
  |                             |-- Send presence snapshot
  |                                    |
  |<-- connection_ack -----------------|
  |<-- presence_snapshot --------------|
  |                                    |
```

---

## 2. User Management

### 2.1 List Users

```
CLIENT                              SERVER
  |                                    |
  |-- GET /api/users ----------------->|
  |   ?page=1&limit=20&search=         |
  |                                    |
  |                         [userController.list]
  |                             |-- Authenticate (JWT)
  |                             |-- [UserService.getUsers]
  |                             |     |-- Build filters (companyId, search, etc.)
  |                             |     |-- [userRepository.findAll]
  |                             |     |     |-- Query users with pagination
  |                             |     |     |-- Apply company filter
  |                             |     |     |-- Apply search filter
  |                             |     |-- Return { users, pagination }
  |                             |
  |<-- 200 OK { users, pagination } --|
  |                                    |
```

### 2.2 Create User (Admin)

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/users ---------------->|
  |   { firstName, lastName, email,    |
  |     password, role, department_id } |
  |                                    |
  |                         [userController.create]
  |                             |-- Authenticate (JWT)
  |                             |-- Authorize (admin+)
  |                             |-- [UserService.createUser]
  |                             |     |-- Validate input
  |                             |     |-- Check email uniqueness
  |                             |     |-- Hash password (bcrypt)
  |                             |     |-- Create user
  |                             |     |     [userRepository.create]
  |                             |     |-- Log audit event
  |                             |     |     [auditLogService.log]
  |                             |     |-- Return user
  |                             |
  |<-- 201 Created { user } ----------|
  |                                    |
```

### 2.3 Update User

```
CLIENT                              SERVER
  |                                    |
  |-- PATCH /api/users/:id ----------->|
  |   { firstName, lastName, role, ... }|
  |                                    |
  |                         [userController.update]
  |                             |-- Authenticate
  |                             |-- [UserService.updateUser]
  |                             |     |-- Validate input
  |                             |     |-- Check user exists
  |                             |     |-- Update user fields
  |                             |     |     [userRepository.update]
  |                             |     |-- Return updated user
  |                             |
  |<-- 200 OK { user } ---------------|
  |                                    |
```

### 2.4 Delete User (Soft Delete)

```
CLIENT                              SERVER
  |                                    |
  |-- DELETE /api/users/:id ---------->|
  |                                    |
  |                         [userController.remove]
  |                             |-- Authenticate
  |                             |-- [UserService.deleteUser]
  |                             |     |-- Check user exists
  |                             |     |-- Soft delete (is_active=0)
  |                             |     |     [userRepository.softDelete]
  |                             |     |-- Log audit event
  |                             |     |-- Return { message }
  |                             |
  |<-- 200 OK { message } ------------|
  |                                    |
```

### 2.5 Avatar Upload

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/users/avatar --------->|
  |   (multipart/form-data)            |
  |                                    |
  |                         [userController.uploadAvatar]
  |                             |-- Authenticate
  |                             |-- Validate file (size, type)
  |                             |-- Save file to /uploads
  |                             |-- Update user profile_picture
  |                             |     [userRepository.update]
  |                             |-- Broadcast user_profile_updated
  |                             |     [sendToUser]
  |                             |
  |<-- 200 OK { profile_picture } ----|
  |                                    |
  | (All connected clients receive)    |
  | user_profile_updated event         |
  |                                    |
```

### 2.6 Change Password

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/auth/change-password -->|
  |   { currentPassword, newPassword }  |
  |                                    |
  |                         [authController.changePassword]
  |                             |-- Authenticate
  |                             |-- [AuthService.changePassword]
  |                             |     |-- Find user
  |                             |     |-- Verify current password
  |                             |     |-- Check company min password length
  |                             |     |-- Hash new password
  |                             |     |-- Update password
  |                             |     |-- Return { message }
  |                             |
  |<-- 200 OK { message } ------------|
  |                                    |
```

---

## 3. Team Management

### 3.1 Create Team

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/teams ---------------->|
  |   { name, description,            |
  |     member_ids: [1, 2, 3] }        |
  |                                    |
  |                         [teamController.create]
  |                             |-- Authenticate
  |                             |-- Authorize (create_teams capability)
  |                             |-- [TeamService.createTeam]
  |                             |     |-- Validate input
  |                             |     |-- Check company limit (optional)
  |                             |     |-- Create team
  |                             |     |     [teamRepository.create]
  |                             |     |-- Add creator as leader
  |                             |     |     [teamMemberRepository.add]
  |                             |     |-- Add initial members
  |                             |     |-- Log audit event
  |                             |     |-- Return team
  |                             |
  |<-- 201 Created { team } ----------|
  |                                    |
  | (Broadcast workspace_changed)      |
  | [emitWorkspaceChanged]             |
  |                                    |
```

### 3.2 Add Team Member

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/teams/:id/members ---->|
  |   { user_id: 5 }                   |
  |                                    |
  |                         [teamController.addMember]
  |                             |-- Authenticate
  |                             |-- [TeamService.addMember]
  |                             |     |-- Check team exists
  |                             |     |-- Assert can manage members
  |                             |     |     (manage_team_members capability)
  |                             |     |-- Check user not already member
  |                             |     |-- Add member
  |                             |     |     [teamMemberRepository.add]
  |                             |     |-- Sync conversation membership
  |                             |     |     [conversationRepository.addMember]
  |                             |     |-- Return { message }
  |                             |
  |<-- 200 OK { message } ------------|
  |                                    |
  | (Broadcast workspace_changed)      |
  |                                    |
```

### 3.3 Remove Team Member

```
CLIENT                              SERVER
  |                                    |
  |-- DELETE /api/teams/:id/members/5 ->
  |                                    |
  |                         [teamController.removeMember]
  |                             |-- Authenticate
  |                             |-- [TeamService.removeMember]
  |                             |     |-- Check team exists
  |                             |     |-- Assert can manage members
  |                             |     |-- Remove member
  |                             |     |     [teamMemberRepository.remove]
  |                             |     |-- Sync conversation membership
  |                             |     |     [conversationRepository.removeMember]
  |                             |     |-- Return { message }
  |                             |
  |<-- 200 OK { message } ------------|
  |                                    |
```

---

## 4. Channel Management

### 4.1 Create Channel

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/channels ------------>|
  |   { name, description, type,      |
  |     team_id, member_ids }          |
  |                                    |
  |                         [channelController.create]
  |                             |-- Authenticate
  |                             |-- [ChannelService.createChannel]
  |                             |     |-- Assert can create channel
  |                             |     |     (role-based + manage_channels)
  |                             |     |-- Create channel
  |                             |     |     [channelRepository.create]
  |                             |     |-- Add creator as admin
  |                             |     |     [channelMemberRepository.add]
  |                             |     |-- Add initial members
  |                             |     |-- Return channel
  |                             |
  |<-- 201 Created { channel } -------|
  |                                    |
  | (Broadcast workspace_changed)      |
  |                                    |
```

### 4.2 Add Channel Member

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/channels/:id/members ->|
  |   { user_id: 5 }                   |
  |                                    |
  |                         [channelController.addMember]
  |                             |-- Authenticate
  |                             |-- [ChannelService.addMember]
  |                             |     |-- Check channel exists
  |                             |     |-- Assert can manage channel
  |                             |     |-- Check not already member
  |                             |     |-- Add member
  |                             |     |     [channelMemberRepository.add]
  |                             |     |-- Sync conversation membership
  |                             |     |     [conversationRepository.addMember]
  |                             |     |-- Return { message }
  |                             |
  |<-- 200 OK { message } ------------|
  |                                    |
```

---

## 5. Conversation Management

### 5.1 List Conversations

```
CLIENT                              SERVER
  |                                    |
  |-- GET /api/conversations --------->|
  |                                    |
  |                         [conversationController.list]
  |                             |-- Authenticate
  |                             |-- [ConversationService.getConversations]
  |                             |     |-- Find user's conversations
  |                             |     |     [conversationRepository.findAll]
  |                             |     |-- Filter team conversations
  |                             |     |     (must be team member)
  |                             |     |-- Load members for each
  |                             |     |-- Attach channel metadata (omni)
  |                             |     |-- Return { conversations }
  |                             |
  |<-- 200 OK { conversations } ------|
  |                                    |
```

### 5.2 Create Direct Conversation

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/conversations/direct ->|
  |   { user_id: 5 }                   |
  |                                    |
  |                         [conversationController.createDirect]
  |                             |-- Authenticate
  |                             |-- [ConversationService.findOrCreateDirectConversation]
  |                             |     |-- Check for existing direct conversation
  |                             |     |     [conversationRepository.findDirectConversation]
  |                             |     |-- If exists: return existing
  |                             |     |-- If new:
  |                             |     |     |-- Create conversation (type='direct')
  |                             |     |     |     [conversationRepository.create]
  |                             |     |     |-- Add both users as members
  |                             |     |     |     [conversationRepository.addMember]
  |                             |     |     |-- Return conversation
  |                             |
  |<-- 201 Created { conversation } ---|
  |                                    |
```

### 5.3 Open Channel Conversation

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/conversations --------->|
  |   { type: 'channel', name: 'general' }|
  |                                    |
  |                         [conversationController.create]
  |                             |-- Authenticate
  |                             |-- [ConversationService.createConversation]
  |                             |     |-- Check type='channel'
  |                             |     |-- Find existing by name
  |                             |     |     [conversationRepository.findChannelConversation]
  |                             |     |-- If exists:
  |                             |     |     |-- Auto-join all channel members
  |                             |     |     |     [autoJoinChannelMembers]
  |                             |     |     |-- Return existing
  |                             |     |-- If new:
  |                             |     |     |-- Create conversation
  |                             |     |     |-- Add creator as admin
  |                             |     |     |-- Auto-join channel members
  |                             |     |     |-- Return new conversation
  |                             |
  |<-- 201 Created { conversation } ---|
  |                                    |
```

### 5.4 Join/Leave Channel (WebSocket)

```
CLIENT                              SERVER
  |                                    |
  |-- ws.send({ type: 'join_channel' })|
  |   { channelId: 10 }                |
  |                                    |
  |                         [MessageHandler.handleJoinChannel]
  |                             |-- Find conversation
  |                             |-- Check access (team/member)
  |                             |-- Send joined_channel ack
  |                                    |
  |<-- { type: 'joined_channel' } -----|
  |                                    |
```

---

## 6. Messaging

### 6.1 Send Message (WebSocket)

```
CLIENT                              SERVER
  |                                    |
  |-- ws.send({ type: 'send_message' })|
  |   { conversationId: 5, content }   |
  |                                    |
  |                         [MessageHandler.handleSendMessage]
  |                             |-- Validate input
  |                             |-- [MessageService.createMessage]
  |                             |     |-- Check user is conversation member
  |                             |     |-- Extract @mentions
  |                             |     |     [mentions.utils]
  |                             |     |-- Insert message
  |                             |     |     [messageRepository.create]
  |                             |     |-- Create mention notifications
  |                             |     |     [messageService.createMentionNotifications]
  |                             |     |-- Create message notifications
  |                             |     |     [messageService.createMessageNotifications]
  |                             |     |-- Return message with reactions/attachments
  |                             |
  |                             |-- Broadcast to conversation
  |                             |     [broadcastToConversation]
  |                             |     |-- Resolve members
  |                             |     |-- Send receive_message to all (exclude sender)
  |                             |
  |                             |-- Send notification events
  |                             |     [sendToUser] (for mentions)
  |                             |
  |<-- { type: 'message_sent_ack' } ---|
  |   { data: <serialized message> }   |
  |                                    |
  | (Other members receive)            |
  |<-- { type: 'receive_message' } ----|
  |   { message: <serialized> }        |
  |                                    |
```

### 6.2 Send Message with File (REST)

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/messages/upload ------->|
  |   (multipart/form-data)            |
  |   conversation_id: 5               |
  |   file: <binary>                   |
  |                                    |
  |                         [messageController.uploadFile]
  |                             |-- Authenticate
  |                             |-- Validate file (size, type)
  |                             |-- Check feature policy (allow_uploads)
  |                             |-- Save file to /uploads
  |                             |-- [MessageService.createFileMessage]
  |                             |     |-- Check user is conversation member
  |                             |     |-- Create message (type='file')
  |                             |     |     [messageRepository.create]
  |                             |     |-- Create attachment
  |                             |     |     [messageRepository.createAttachment]
  |                             |     |-- Return message
  |                             |
  |<-- 201 Created { message } --------|
  |                                    |
```

### 6.3 Edit Message (WebSocket)

```
CLIENT                              SERVER
  |                                    |
  |-- ws.send({ type: 'message_edited'})|
  |   { messageId: 123, content }      |
  |                                    |
  |                         [MessageHandler.handleMessageEdited]
  |                             |-- [MessageService.updateMessage]
  |                             |     |-- Check user is sender
  |                             |     |-- Update message
  |                             |     |     [messageRepository.update]
  |                             |     |-- Return updated message
  |                             |
  |                             |-- Broadcast message_updated
  |                             |     [broadcastToConversation]
  |                             |
  |<-- { type: 'message_edited_ack' } -|
  |                                    |
  | (Other members receive)            |
  |<-- { type: 'message_updated' } ----|
  |   { message: { id, content } }     |
  |                                    |
```

### 6.4 Delete Message (WebSocket)

```
CLIENT                              SERVER
  |                                    |
  |-- ws.send({ type: 'message_deleted'})|
  |   { messageId: 123 }               |
  |                                    |
  |                         [MessageHandler.handleMessageDeleted]
  |                             |-- [MessageService.deleteMessage]
  |                             |     |-- Check user is sender or admin
  |                             |     |-- Soft delete message
  |                             |     |     [messageRepository.softDelete]
  |                             |     |-- Return { deletedMessage }
  |                             |
  |                             |-- Broadcast message_deleted
  |                             |     [broadcastToConversation]
  |                             |
  |<-- { type: 'message_deleted_ack' }-|
  |                                    |
  | (Other members receive)            |
  |<-- { type: 'message_deleted' } ----|
  |   { message: { id, conversationId } }|
  |                                    |
```

---

## 7. Message Reactions

### 7.1 Add Reaction (WebSocket)

```
CLIENT                              SERVER
  |                                    |
  |-- ws.send({ type: 'message_reacted'})|
  |   { messageId: 123, reaction: '👍' }|
  |                                    |
  |                         [MessageService.addReaction]
  |                             |-- Check reactions enabled (company policy)
  |                             |-- Check user can view message
  |                             |-- Upsert reaction (idempotent)
  |                             |     [reactionRepository.add]
  |                             |-- Get fresh reaction list
  |                             |     [reactionRepository.findByMessage]
  |                             |-- Broadcast message_reacted
  |                             |     [broadcastToConversation]
  |                             |     |-- Send to all members (exclude actor)
  |                             |
  |<-- { type: 'message_reacted' } ----|
  |   { data: { reactions } }          |
  |                                    |
  | (Other members receive)            |
  |<-- { type: 'message_reacted' } ----|
  |   { data: { reactions } }          |
  |                                    |
```

### 7.2 Remove Reaction (WebSocket)

```
CLIENT                              SERVER
  |                                    |
  |-- ws.send({ type: 'message_unreacted'})|
  |   { messageId: 123, reaction: '👍' }|
  |                                    |
  |                         [MessageService.removeReaction]
  |                             |-- Check reactions enabled
  |                             |-- Remove reaction
  |                             |     [reactionRepository.remove]
  |                             |-- Get fresh reaction list
  |                             |-- Broadcast message_unreacted
  |                             |     [broadcastToConversation]
  |                             |
  |<-- { type: 'message_unreacted' } --|
  |   { data: { reactions } }          |
  |                                    |
```

---

## 8. Message Pinning

### 8.1 Pin Message (WebSocket)

```
CLIENT                              SERVER
  |                                    |
  |-- ws.send({ type: 'message_pinned'})|
  |   { messageId: 123 }               |
  |                                    |
  |                         [MessageService.pinMessage]
  |                             |-- Check user is conversation member
  |                             |-- Check pinning enabled (company policy)
  |                             |-- Pin message
  |                             |     [messageRepository.pin]
  |                             |-- Return updated message
  |                             |
  |                             |-- Broadcast message_pinned
  |                             |     [broadcastToConversation]
  |                             |
  |<-- { type: 'message_pinned_ack' } -|
  |   { messageId: 123 }               |
  |                                    |
  | (Other members receive)            |
  |<-- { type: 'message_pinned' } -----|
  |   { message: { id, isPinned: true } }|
  |                                    |
```

### 8.2 Unpin Message (WebSocket)

```
CLIENT                              SERVER
  |                                    |
  |-- ws.send({ type: 'message_unpinned'})|
  |   { messageId: 123 }               |
  |                                    |
  |                         [MessageService.unpinMessage]
  |                             |-- Unpin message
  |                             |     [messageRepository.unpin]
  |                             |-- Broadcast message_unpinned
  |                             |     [broadcastToConversation]
  |                             |
  |<-- { type: 'message_unpinned_ack' }|
  |                                    |
  | (Other members receive)            |
  |<-- { type: 'message_unpinned' } ---|
  |   { message: { id, isPinned: false } }|
  |                                    |
```

---

## 9. Message Forwarding

```
CLIENT                              SERVER
  |                                    |
  |-- ws.send({ type: 'forward_message'})|
  |   { messageId: 123,               |
  |     targetConversationId: 8 }      |
  |                                    |
  |                         [MessageHandler.handleForwardMessage]
  |                             |-- [MessageService.forwardMessage]
  |                             |     |-- Check source message exists
  |                             |     |-- Check user has access to both conversations
  |                             |     |-- Create new message
  |                             |     |     [messageRepository.create]
  |                             |     |     (type='forwarded', reply_to=source)
  |                             |     |-- Return forwarded message
  |                             |
  |                             |-- Broadcast message_forwarded
  |                             |     [broadcastToConversation]
  |                             |     (to target conversation)
  |                             |
  |<-- { type: 'message_forwarded_ack' }|
  |   { messageId, targetConversationId }|
  |                                    |
  | (Target conversation members receive)|
  |<-- { type: 'message_forwarded' } --|
  |   { message: <forwarded message> } |
  |                                    |
```

---

## 10. Message Reminders

### 10.1 Set Reminder

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/messages/:id/reminder ->|
  |   { remindAt: '2026-09-15T10:00' } |
  |                                    |
  |                         [reminderController.set]
  |                             |-- Authenticate
  |                             |-- [ReminderService.setReminder]
  |                             |     |-- Check message exists
  |                             |     |-- Create reminder
  |                             |     |     [reminderRepository.create]
  |                             |     |-- Return { id }
  |                             |
  |<-- 201 Created { id } ------------|
  |                                    |
```

### 10.2 Process Due Reminders (Background Scheduler)

```
SERVER (every 30 seconds)
  |                                    |
  | [setInterval - reminderService.processDueReminders]
  |                             |-- Find due reminders
  |                             |     [reminderRepository.findDueReminders]
  |                             |-- For each due reminder:
  |                             |     |-- Check notification preference
  |                             |     |     (category: 'reminders')
  |                             |     |-- Get message with sender
  |                             |     |     [messageRepository.findByIdWithSender]
  |                             |     |-- Create notification
  |                             |     |     [notificationRepository.create]
  |                             |     |     type='message_reminder'
  |                             |     |-- Send WebSocket event
  |                             |     |     [sendToUser]
  |                             |     |     type='reminder'
  |                             |     |-- Mark as sent
  |                             |     |     [reminderRepository.markAsSent]
  |                             |
  | (User receives)                    |
  |<-- { type: 'reminder' } -----------|
  |   { messageId, title, body }       |
  |                                    |
```

---

## 11. Message Bookmarks

### 11.1 Bookmark Message

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/bookmarks ------------>|
  |   { message_id: 123 }              |
  |                                    |
  |                         [bookmarkController.add]
  |                             |-- Authenticate
  |                             |-- [BookmarkService.bookmark]
  |                             |     |-- Check message exists
  |                             |     |-- Check conversation access
  |                             |     |-- Create bookmark
  |                             |     |     [bookmarkRepository.create]
  |                             |     |-- Return bookmark
  |                             |
  |<-- 201 Created { bookmark } ------|
  |                                    |
  | (Broadcast bookmark_added)         |
  |<-- { type: 'bookmark_added' } ----|
  |   { data: { messageId } }          |
  |                                    |
```

### 11.2 Unbookmark Message

```
CLIENT                              SERVER
  |                                    |
  |-- DELETE /api/bookmarks/:messageId ->
  |                                    |
  |                         [bookmarkController.remove]
  |                             |-- Authenticate
  |                             |-- [BookmarkService.unbookmark]
  |                             |     |-- Check conversation access
  |                             |     |-- Remove bookmark
  |                             |     |     [bookmarkRepository.remove]
  |                             |     |-- Return { removed }
  |                             |
  |<-- 200 OK { removed } ------------|
  |                                    |
  | (Broadcast bookmark_removed)       |
  |<-- { type: 'bookmark_removed' } --|
  |   { data: { messageId } }          |
  |                                    |
```

---

## 12. File Sharing

### 12.1 Upload File to Shared Files

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/shared-files/upload -->|
  |   (multipart/form-data)            |
  |   file: <binary>                   |
  |   team_id?: 5                      |
  |   description?: "Project doc"      |
  |                                    |
  |                         [sharedFileController.upload]
  |                             |-- Authenticate
  |                             |-- Validate file (size, type)
  |                             |-- Check feature policy (allow_uploads)
  |                             |-- If team_id: check team membership
  |                             |     [assertCanUploadToTeam]
  |                             |-- Save file to /uploads
  |                             |-- [SharedFileService.createSharedFile]
  |                             |     |-- Create shared file record
  |                             |     |     [sharedFileRepository.create]
  |                             |     |-- If public: create manage permission
  |                             |     |     [sharedFileRepository.createPermission]
  |                             |     |-- Return file
  |                             |
  |<-- 201 Created { file } ----------|
  |                                    |
```

### 12.2 Share File with Team/Conversation

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/shared-files/:id/share ->
  |   { target_type: 'team',           |
  |     target_id: 5 }                 |
  |                                    |
  |                         [sharedFileController.share]
  |                             |-- Authenticate
  |                             |-- [SharedFileService.shareFile]
  |                             |     |-- Check file exists
  |                             |     |-- Check can manage file
  |                             |     |-- Validate target (team/conversation)
  |                             |     |-- Create share record
  |                             |     |     [sharedFileRepository.createShare]
  |                             |     |-- Return share
  |                             |
  |<-- 201 Created { share } ---------|
  |                                    |
```

### 12.3 Embed File in Conversation

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/shared-files/:id/embed ->
  |   { conversationId: 5 }            |
  |                                    |
  |                         [sharedFileController.embedInConversation]
  |                             |-- Authenticate
  |                             |-- [SharedFileService.embedInConversation]
  |                             |     |-- Check file access
  |                             |     |-- Check conversation membership
  |                             |     |-- Create share (upsert)
  |                             |     |     [sharedFileRepository.createShare]
  |                             |     |-- Create file message
  |                             |     |     [messageService.createFileMessage]
  |                             |     |-- Return { file, message, share }
  |                             |
  |<-- 201 Created { file, message } -|
  |                                    |
  | (Message appears in conversation)  |
  |<-- receive_message ----------------|
  |   { type: 'file', file_url: ... }  |
  |                                    |
```

---

## 13. Shared Files

### 13.1 List Shared Files

```
CLIENT                              SERVER
  |                                    |
  |-- GET /api/shared-files ---------->|
  |   ?page=1&limit=20&search=doc      |
  |                                    |
  |                         [sharedFileController.list]
  |                             |-- Authenticate
  |                             |-- [SharedFileService.listSharedFiles]
  |                             |     |-- Build filters
  |                             |     |-- Query files (company-scoped)
  |                             |     |     [sharedFileRepository.findAll]
  |                             |     |-- Return { files, total }
  |                             |
  |<-- 200 OK { files, total } -------|
  |                                    |
```

### 13.2 Upload New Version

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/shared-files/:id/versions ->
  |   (multipart/form-data)            |
  |   file: <new binary>               |
  |   change_description: "v2"         |
  |                                    |
  |                         [sharedFileController.addVersion]
  |                             |-- Authenticate
  |                             |-- [SharedFileService.uploadNewVersion]
  |                             |     |-- Check file exists
  |                             |     |-- Check can edit (owner/manage)
  |                             |     |-- Save new version
  |                             |     |     [sharedFileRepository.createVersion]
  |                             |     |-- Update current file metadata
  |                             |     |     [sharedFileRepository.update]
  |                             |     |-- Return version
  |                             |
  |<-- 201 Created { version } --------|
  |                                    |
  | (Broadcast shared_file_version_uploaded)|
  |<-- { type: 'shared_file_version_uploaded' }|
  |   { data: { fileId, version } }    |
  |                                    |
```

### 13.3 Grant Permission

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/shared-files/:id/permissions ->
  |   { user_id: 5, permission: 'view' }|
  |                                    |
  |                         [sharedFileController.grantPermission]
  |                             |-- Authenticate
  |                             |-- [SharedFileService.grantPermission]
  |                             |     |-- Check file exists
  |                             |     |-- Check can manage (owner/manage)
  |                             |     |-- Create permission
  |                             |     |     [sharedFileRepository.createPermission]
  |                             |     |-- Return permission
  |                             |
  |<-- 201 Created { permission } -----|
  |                                    |
  | (Broadcast shared_file_permission_granted)|
  |<-- { type: 'shared_file_permission_granted' }|
  |   { data: { permission } }         |
  |                                    |
```

---

## 14. Meetings

### 14.1 Create Meeting

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/meetings ------------>|
  |   { title, meeting_date,          |
  |     start_time, end_time,          |
  |     participants: [1, 2, 3],       |
  |     organizer_id: 1,               |
  |     remind_before_minutes: 15 }    |
  |                                    |
  |                         [meetingController.create]
  |                             |-- Authenticate
  |                             |-- [MeetingService.createMeeting]
  |                             |     |-- Validate input
  |                             |     |-- Create meeting
  |                             |     |     [meetingRepository.create]
  |                             |     |-- Create attendee records
  |                             |     |     [meetingAttendeeRepository.createAttendee]
  |                             |     |     (status='pending' for participants,
  |                             |     |      status='accepted' for organizer)
  |                             |     |-- Create reminder records
  |                             |     |     [meetingReminderRepository.create]
  |                             |     |-- Send notifications to participants
  |                             |     |     [notificationRepository.create]
  |                             |     |     (respects notification preferences)
  |                             |     |-- Send WebSocket events
  |                             |     |     [sendToUser]
  |                             |     |     type='notification'
  |                             |     |     data.type='meeting_invite'
  |                             |     |-- Return meeting
  |                             |
  |<-- 201 Created { meeting } --------|
  |                                    |
```

### 14.2 Update Meeting

```
CLIENT                              SERVER
  |                                    |
  |-- PATCH /api/meetings/:id --------->|
  |   { title, meeting_date,           |
  |     start_time, participants }      |
  |                                    |
  |                         [meetingController.update]
  |                             |-- Authenticate
  |                             |-- [MeetingService.updateMeeting]
  |                             |     |-- Check meeting exists
  |                             |     |-- Update fields
  |                             |     |     [meetingRepository.update]
  |                             |     |-- Return updated meeting
  |                             |
  |<-- 200 OK { meeting } ------------|
  |                                    |
  | (Broadcast meeting_updated)        |
  |<-- { type: 'meeting_updated' } ----|
  |   { data: { meeting } }            |
  |                                    |
```

### 14.3 Cancel Meeting

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/meetings/:id/cancel -->|
  |                                    |
  |                         [meetingController.cancel]
  |                             |-- Authenticate
  |                             |-- [MeetingService.cancelMeeting]
  |                             |     |-- Check meeting exists
  |                             |     |-- Update status → 'cancelled'
  |                             |     |     [meetingRepository.update]
  |                             |     |-- Return { message }
  |                             |
  |<-- 200 OK { message } ------------|
  |                                    |
  | (Broadcast meeting_cancelled)      |
  |<-- { type: 'meeting_cancelled' } -|
  |   { data: { meeting: { id } } }    |
  |                                    |
```

### 14.4 RSVP to Meeting

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/meetings/:id/attendees/me ->
  |   { rsvp: 'accepted' }             |
  |                                    |
  |                         [meetingController.updateAttendeeRsvp]
  |                             |-- Authenticate
  |                             |-- [MeetingService.updateAttendeeRsvp]
  |                             |     |-- Check meeting exists
  |                             |     |-- Check user is participant/organizer
  |                             |     |-- Update RSVP
  |                             |     |     [meetingAttendeeRepository.updateRsvp]
  |                             |     |-- Return attendee
  |                             |
  |<-- 200 OK { attendee } -----------|
  |                                    |
  | (Broadcast meeting_attendee_updated)|
  |<-- { type: 'meeting_attendee_updated' }|
  |   { data: { attendee, meetingId } }|
  |                                    |
```

### 14.5 Add Meeting Note

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/meetings/:id/notes --->|
  |   { content: "Discussion points..." }|
  |                                    |
  |                         [meetingController.addNote]
  |                             |-- Authenticate
  |                             |-- [MeetingService.createMeetingNote]
  |                             |     |-- Check meeting exists
  |                             |     |-- Create note
  |                             |     |     [meetingNoteRepository.create]
  |                             |     |-- Return note
  |                             |
  |<-- 201 Created { note } ----------|
  |                                    |
  | (Broadcast meeting_note_added)     |
  |<-- { type: 'meeting_note_added' }-|
  |   { data: { note, meetingId } }    |
  |                                    |
```

### 14.6 Process Meeting Reminders (Background Scheduler)

```
SERVER (every 30 seconds)
  |                                    |
  | [meetingService.processDueMeetingReminders]
  |                             |-- Find due reminders
  |                             |     [meetingReminderRepository.findDueReminders]
  |                             |-- For each due reminder:
  |                             |     |-- Check meeting is 'scheduled'
  |                             |     |-- Check notification preference
  |                             |     |     (category: 'meetings')
  |                             |     |-- Create notification
  |                             |     |     [notificationRepository.create]
  |                             |     |     type='meeting_reminder'
  |                             |     |-- Send WebSocket event
  |                             |     |     [sendToUser]
  |                             |     |     type='meeting_reminder'
  |                             |     |-- Mark as sent
  |                             |     |     [meetingReminderRepository.markAsSent]
  |                             |
  | (User receives)                    |
  |<-- { type: 'meeting_reminder' } ---|
  |   { meetingId, title, startTime }  |
  |                                    |
```

---

## 15. Tasks

### 15.1 Create Task

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/tasks ---------------->|
  |   { title, description,            |
  |     assignee_id: 5,                |
  |     team_id: 3,                    |
  |     due_date: '2026-09-20',        |
  |     priority: 'high' }             |
  |                                    |
  |                         [taskController.create]
  |                             |-- Authenticate
  |                             |-- [TaskService.createTask]
  |                             |     |-- Validate input
  |                             |     |-- Check assignee (if assigned to other)
  |                             |     |     (only managers can assign)
  |                             |     |-- Check team (if team task)
  |                             |     |     (user must be team member)
  |                             |     |-- Create task
  |                             |     |     [taskRepository.create]
  |                             |     |-- If assigned to other:
  |                             |     |     |-- Notify assignee
  |                             |     |     |     [notifyAssigned]
  |                             |     |     |     [sendToUser]
  |                             |     |     |     type='notification'
  |                             |     |     |     data.type='task_assigned'
  |                             |     |-- Return task
  |                             |
  |<-- 201 Created { task } ----------|
  |                                    |
```

### 15.2 Update Task

```
CLIENT                              SERVER
  |                                    |
  |-- PATCH /api/tasks/:id ----------->|
  |   { status: 'in_progress' }        |
  |                                    |
  |                         [taskController.update]
  |                             |-- Authenticate
  |                             |-- [TaskService.updateTask]
  |                             |     |-- Check task exists
  |                             |     |-- Check permissions
  |                             |     |     (creator/assignee/team member/manager)
  |                             |     |-- Validate fields
  |                             |     |-- Update task
  |                             |     |     [taskRepository.update]
  |                             |     |-- If assignment changed:
  |                             |     |     |-- Notify new assignee
  |                             |     |-- Return updated task
  |                             |
  |<-- 200 OK { task } ---------------|
  |                                    |
```

### 15.3 Add Comment to Task

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/tasks/:id/comments --->|
  |   { content: "Update: started..." }|
  |                                    |
  |                         [taskController.addComment]
  |                             |-- Authenticate
  |                             |-- [TaskService.addComment]
  |                             |     |-- Check task exists
  |                             |     |-- Check can view task
  |                             |     |-- Create comment
  |                             |     |     [taskRepository.createComment]
  |                             |     |-- Return comment
  |                             |
  |<-- 201 Created { comment } --------|
  |                                    |
```

### 15.4 Process Due Task Deadlines (Background Scheduler)

```
SERVER (every 30 seconds)
  |                                    |
  | [taskService.processDueTaskDeadlines]
  |                             |-- Find unreminded due tasks
  |                             |     [taskRepository.findUnremindedDueTasks]
  |                             |-- For each due task:
  |                             |     |-- Check notification preference
  |                             |     |     (category: 'tasks')
  |                             |     |-- Determine type:
  |                             |     |     'task_deadline' (due today)
  |                             |     |     'task_overdue' (past due)
  |                             |     |-- Create notification
  |                             |     |     [notificationRepository.create]
  |                             |     |-- Send WebSocket event
  |                             |     |     [sendToUser]
  |                             |     |     type='notification'
  |                             |     |     data.type='task_deadline'
  |                             |     |-- Mark as reminded
  |                             |     |     [taskRepository.markDeadlineReminded]
  |                             |
  | (User receives)                    |
  |<-- { type: 'notification' } -------|
  |   { data: { type: 'task_deadline' }|
  |                                    |
```

### 15.5 Add Task Reaction (WebSocket)

```
CLIENT                              SERVER
  |                                    |
  |-- ws.send({ type: 'task_reacted' })|
  |   { taskId: 10, reaction: '✅' }   |
  |                                    |
  |                         [TaskService.addReaction]
  |                             |-- Check reactions enabled
  |                             |-- Check can view task
  |                             |-- Add reaction
  |                             |     [taskRepository.addReaction]
  |                             |-- Broadcast task_reacted
  |                             |     [broadcastReactions]
  |                             |     |-- Send to all viewers (exclude actor)
  |                             |
  |<-- { type: 'task_reacted' } -------|
  |   { data: { taskId, reactions } }  |
  |                                    |
```

---

## 16. Announcements

### 16.1 Create Announcement

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/announcements -------->|
  |   { title, content,                |
  |     scope: 'company',              |
  |     is_pinned: true,               |
  |     scheduled_at?: '2026-09-20' }  |
  |                                    |
  |                         [announcementController.create]
  |                             |-- Authenticate
  |                             |-- Authorize (publish_announcements)
  |                             |-- [AnnouncementService.createAnnouncement]
  |                             |     |-- Validate input
  |                             |     |-- Validate target (scope + dept/team)
  |                             |     |-- Determine is_published:
  |                             |     |     immediate → 1
  |                             |     |     future → 0
  |                             |     |-- Create announcement
  |                             |     |     [announcementRepository.create]
  |                             |     |-- If immediate:
  |                             |     |     |-- Notify recipients
  |                             |     |     |     [notifyRecipients]
  |                             |     |     |     [notificationRepository.create]
  |                             |     |     |-- Broadcast announcement_created
  |                             |     |     |     [emitAnnouncementToUsers]
  |                             |     |     |-- Broadcast notification
  |                             |     |     |     [emitAnnouncementToUsers]
  |                             |     |-- Return announcement
  |                             |
  |<-- 201 Created { announcement } ---|
  |                                    |
```

### 16.2 Process Scheduled Announcements (Background Scheduler)

```
SERVER (every 30 seconds)
  |                                    |
  | [announcementService.processDueScheduledAnnouncements]
  |                             |-- Find due scheduled announcements
  |                             |     [announcementRepository.findDueScheduled]
  |                             |-- For each due announcement:
  |                             |     |-- Mark as published
  |                             |     |     [announcementRepository.markPublished]
  |                             |     |-- Notify recipients
  |                             |     |     [notifyRecipients]
  |                             |     |-- Broadcast announcement_created
  |                             |     |     [emitAnnouncementToUsers]
  |                             |     |-- Broadcast notification
  |                             |     |     [emitAnnouncementToUsers]
  |                             |
  | (Recipients receive)               |
  |<-- { type: 'announcement_created' }|
  |   { data: { announcement } }       |
  |<-- { type: 'notification' } -------|
  |   { data: { type: 'announcement' } |
  |                                    |
```

### 16.3 Mark Announcement as Read

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/announcements/:id/read ->
  |                                    |
  |                         [announcementController.markRead]
  |                             |-- Authenticate
  |                             |-- [AnnouncementService.markRead]
  |                             |     |-- Check announcement visible
  |                             |     |-- Check is published
  |                             |     |-- Mark as read (idempotent)
  |                             |     |     [announcementRepository.markRead]
  |                             |     |-- Return announcement
  |                             |
  |<-- 200 OK { announcement } --------|
  |                                    |
```

---

## 17. Notifications

### 17.1 List Notifications

```
CLIENT                              SERVER
  |                                    |
  |-- GET /api/notifications --------->|
  |   ?page=1&limit=20                 |
  |                                    |
  |                         [notificationController.list]
  |                             |-- Authenticate
  |                             |-- [NotificationService.getNotifications]
  |                             |     |-- Fetch notifications
  |                             |     |     [notificationRepository.findAll]
  |                             |     |-- Get unread count
  |                             |     |     [notificationRepository.getUnreadCount]
  |                             |     |-- Enrich with reactions
  |                             |     |     [attachReactions]
  |                             |     |     (messages, announcements, tasks)
  |                             |     |-- Return { notifications, unreadCount }
  |                             |
  |<-- 200 OK { notifications,        |
  |          unreadCount } -----------|
  |                                    |
```

### 17.2 Mark Notification as Read

```
CLIENT                              SERVER
  |                                    |
  |-- PATCH /api/notifications/:id/read ->
  |                                    |
  |                         [notificationController.markRead]
  |                             |-- Authenticate
  |                             |-- [NotificationService.markAsRead]
  |                             |     |-- Mark as read
  |                             |     |     [notificationRepository.markAsRead]
  |                             |     |-- Return true
  |                             |
  |<-- 200 OK { success: true } ------|
  |                                    |
```

### 17.3 Mark All Notifications as Read

```
CLIENT                              SERVER
  |                                    |
  |-- PATCH /api/notifications/read-all ->
  |                                    |
  |                         [notificationController.markAllRead]
  |                             |-- Authenticate
  |                             |-- [NotificationService.markAllAsRead]
  |                             |     |-- Mark all as read
  |                             |     |     [notificationRepository.markAllAsRead]
  |                             |     |-- Return true
  |                             |
  |<-- 200 OK { success: true } ------|
  |                                    |
```

---

## 18. Attendance

### 18.1 Clock In

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/attendance/clock-in -->|
  |                                    |
  |                         [attendanceController.clockIn]
  |                             |-- Authenticate
  |                             |-- [AttendanceService.clockIn]
  |                             |     |-- Check user exists + is_active
  |                             |     |-- Check not holiday
  |                             |     |     [holidayRepository.findByDate]
  |                             |     |-- Check not on approved leave
  |                             |     |     [leaveRequestRepository.findApprovedOverlap]
  |                             |     |-- Check working day
  |                             |     |     [workScheduleService.getForWeekday]
  |                             |     |-- Check not already clocked in
  |                             |     |     [attendanceRepository.findByEmployeeAndDate]
  |                             |     |-- Calculate late minutes
  |                             |     |-- Set status ('present' | 'late')
  |                             |     |-- Create/update attendance record
  |                             |     |     [attendanceRepository.create/update]
  |                             |     |-- Invalidate dashboard cache
  |                             |     |     [redisClient.del]
  |                             |     |-- Publish event
  |                             |     |     [events.publish]
  |                             |     |     type='attendance:clocked_in'
  |                             |     |-- Publish status change
  |                             |     |     type='attendance:status_changed'
  |                             |     |-- Return record
  |                             |
  |<-- 200 OK { record } -------------|
  |                                    |
  | (User receives via Redis relay)    |
  |<-- { type: 'attendance:clocked_in' }|
  |   { data: { record } }            |
  |<-- { type: 'attendance:status_changed' }|
  |   { data: { status, record } }    |
  |                                    |
```

### 18.2 Clock Out

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/attendance/clock-out ->|
  |                                    |
  |                         [AttendanceService.clockOut]
  |                             |-- Check user exists
  |                             |-- Check clocked in
  |                             |-- Check no running break
  |                             |     [attendanceRepository.findRunningBreak]
  |                             |-- Calculate:
  |                             |     total_work_minutes
  |                             |     (clock_out - clock_in - breaks)
  |                             |     late_minutes
  |                             |     early_leave_minutes
  |                             |     overtime_minutes
  |                             |     under_time_minutes
  |                             |-- Update record
  |                             |     [attendanceRepository.update]
  |                             |-- Invalidate dashboard cache
  |                             |-- Publish events
  |                             |     type='attendance:clocked_out'
  |                             |     type='attendance:status_changed'
  |                             |-- Return updated record
  |                                    |
  |<-- 200 OK { record } -------------|
  |                                    |
```

### 18.3 Start Break

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/attendance/break/start ->
  |                                    |
  |                         [AttendanceService.startBreak]
  |                             |-- Check user exists
  |                             |-- Check clocked in
  |                             |-- Check no running break
  |                             |-- Create break record
  |                             |     [attendanceRepository.createBreak]
  |                             |-- Invalidate dashboard cache
  |                             |-- Publish event
  |                             |     type='attendance:break_started'
  |                             |-- Return { breakId, startedAt }
  |                                    |
  |<-- 200 OK { breakId, startedAt } -|
  |                                    |
```

### 18.4 End Break

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/attendance/break/end ->|
  |                                    |
  |                         [AttendanceService.endBreak]
  |                             |-- Check user exists
  |                             |-- Check clocked in
  |                             |-- Find running break
  |                             |-- Calculate duration
  |                             |-- End break
  |                             |     [attendanceRepository.endBreak]
  |                             |-- Invalidate dashboard cache
  |                             |-- Publish event
  |                             |     type='attendance:break_ended'
  |                             |-- Return { breakId, durationMinutes }
  |                                    |
  |<-- 200 OK { breakId, duration } --|
  |                                    |
```

### 18.5 Get Attendance Dashboard (Manager)

```
CLIENT                              SERVER
  |                                    |
  |-- GET /api/attendance/dashboard -->|
  |   ?date=2026-09-14                |
  |                                    |
  |                         [AttendanceService.getDashboard]
  |                             |-- Check cache (Redis, 10s TTL)
  |                             |     [redisClient.get]
  |                             |-- If cached: return cached
  |                             |-- If not cached:
  |                             |     |-- Get all active users
  |                             |     |     [userRepository.findAll]
  |                             |     |-- Get attendance records
  |                             |     |     [attendanceRepository.findByCompanyBetween]
  |                             |     |-- Get holidays
  |                             |     |     [holidayRepository.findByDate]
  |                             |     |-- Get approved leaves
  |                             |     |     [leaveRequestRepository.findByCompany]
  |                             |     |-- For each user:
  |                             |     |     |-- Get work schedule
  |                             |     |     |     [workScheduleService.getForWeekday]
  |                             |     |     |-- Determine status:
  |                             |     |     |     holiday → holiday
  |                             |     |     |     on_leave → on_leave
  |                             |     |     |     day_off → day_off
  |                             |     |     |     clocked_in → present/late
  |                             |     |     |     else → absent/not_started
  |                             |     |     |-- Check running break
  |                             |     |     |     [attendanceRepository.findRunningBreak]
  |                             |     |-- Build dashboard stats
  |                             |     |     (present, late, absent, etc.)
  |                             |     |-- Cache result (10s)
  |                             |     |     [redisClient.set]
  |                             |     |-- Return dashboard
  |                             |
  |<-- 200 OK { dashboard } ----------|
  |                                    |
```

### 18.6 Get Employee Attendance (Manager)

```
CLIENT                              SERVER
  |                                    |
  |-- GET /api/attendance/employees --->
  |   ?year=2026&month=9               |
  |                                    |
  |                         [AttendanceService.getEmployees]
  |                             |-- Get all active users
  |                             |     [userRepository.findAll]
  |                             |-- Get attendance records
  |                             |     [attendanceRepository.findByCompanyBetween]
  |                             |-- Get holidays
  |                             |     [holidayRepository.findBetween]
  |                             |-- Get approved leaves
  |                             |     [leaveRequestRepository.findByCompany]
  |                             |-- Get work schedules
  |                             |     [workScheduleRepository.findAllByCompany]
  |                             |-- For each user:
  |                             |     |-- Ensure schedule exists
  |                             |     |     [workScheduleService.ensureSchedule]
  |                             |     |-- Build calendar days
  |                             |     |     [buildDay]
  |                             |     |-- Summarize month
  |                             |     |     [summarizeDays]
  |                             |-- Return employees[]
  |                             |
  |<-- 200 OK { employees } ----------|
  |                                    |
```

---

## 19. Leave Management

### 19.1 Create Leave Request

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/leave-requests ------->|
  |   { employee_id: 5,                |
  |     leave_type: 'annual',          |
  |     start_date: '2026-09-20',      |
  |     end_date: '2026-09-22' }       |
  |                                    |
  |                         [leaveRequestController.create]
  |                             |-- Authenticate
  |                             |-- [LeaveService.create]
  |                             |     |-- Validate input
  |                             |     |     (type, date format, start <= end)
  |                             |     |-- Check overlap
  |                             |     |     [leaveRequestRepository.findOverlap]
  |                             |     |     (reject overlapping requests)
  |                             |     |-- Create request
  |                             |     |     [leaveRequestRepository.create]
  |                             |     |-- Return request
  |                             |
  |<-- 201 Created { request } --------|
  |                                    |
```

### 19.2 Approve/Reject Leave Request

```
CLIENT                              SERVER
  |                                    |
  |-- PATCH /api/leave-requests/:id/status ->
  |   { status: 'approved' }            |
  |                                    |
  |                         [leaveRequestController.updateStatus]
  |                             |-- Authenticate
  |                             |-- Authorize (manager+)
  |                             |-- [LeaveService.setStatus]
  |                             |     |-- Check request exists
  |                             |     |-- Check status is 'pending'
  |                             |     |-- Update status
  |                             |     |     [leaveRequestRepository.setStatus]
  |                             |     |-- Return updated request
  |                             |
  |<-- 200 OK { request } ------------|
  |                                    |
  | (Attendance calendar updates)      |
  | (Clock-in blocked for those dates) |
  |                                    |
```

---

## 20. Holidays

### 20.1 Create Holiday

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/holidays ------------>|
  |   { name: 'Independence Day',      |
  |     date: '2026-09-24',            |
  |     description: 'National holiday' }|
  |                                    |
  |                         [holidayController.create]
  |                             |-- Authenticate
  |                             |-- [HolidayService.create]
  |                             |     |-- Validate input
  |                             |     |-- Check date unique
  |                             |     |     [holidayRepository.findByDate]
  |                             |     |-- Create holiday
  |                             |     |     [holidayRepository.create]
  |                             |     |-- Return holiday
  |                             |
  |<-- 201 Created { holiday } --------|
  |                                    |
```

**Effect on Attendance:**
- Holiday overrides normal schedule
- Clock-in is blocked
- Dashboard shows all employees as `holiday`
- Required work minutes = 0

---

## 21. Work Schedules

### 21.1 Create/Update Work Schedule

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/work-schedules ------->|
  |   { employee_id: 5,                |
  |     day_of_week: 1,                |
  |     start_time: '09:00',           |
  |     end_time: '17:30',             |
  |     break_minutes: 60,             |
  |     is_working_day: 1 }            |
  |                                    |
  |                         [workScheduleController.create]
  |                             |-- Authenticate
  |                             |-- [WorkScheduleService.upsert]
  |                             |     |-- Validate input
  |                             |     |-- Check employee exists
  |                             |     |-- Check start < end
  |                             |     |-- Upsert schedule entry
  |                             |     |     [workScheduleRepository.create/update]
  |                             |     |-- Return schedule
  |                             |
  |<-- 201 Created { schedule } -------|
  |                                    |
```

**Default Schedule (auto-materialized):**
- Monday–Friday: 08:00–17:00, 60min break, 480min required
- Saturday–Sunday: Day off (0 required minutes)

---

## 22. Overtime

### 22.1 Request Overtime

```
CLIENT                              SERVER
  |                                    |
  |-- POST /api/overtime ------------->|
  |   { date: '2026-09-14',            |
  |     minutes: 120,                  |
  |     reason: 'Urgent delivery' }    |
  |                                    |
  |                         [attendanceController.requestOvertime]
  |                             |-- Authenticate
  |                             |-- [AttendanceService.requestOvertime]
  |                             |     |-- Validate input
  |                             |     |-- Check no pending overtime for date
  |                             |     |     [attendanceRepository.findOvertimeByEmployeeAndDate]
  |                             |     |-- Link to attendance record (if exists)
  |                             |     |-- Create overtime request
  |                             |     |     [attendanceRepository.createOvertime]
  |                             |     |     status='pending'
  |                             |     |-- Return request
  |                             |
  |<-- 201 Created { request } --------|
  |                                    |
```

### 22.2 Approve Overtime

```
CLIENT                              SERVER
  |                                    |
  |-- PATCH /api/overtime/:id/status ->|
  |   { status: 'approved' }            |
  |                                    |
  |                         [attendanceController.setOvertimeStatus]
  |                             |-- Authenticate
  |                             |-- Authorize (manager+)
  |                             |-- [AttendanceService.setOvertimeStatus]
  |                             |     |-- Check request exists
  |                             |     |-- Check status is 'pending'
  |                             |     |-- Update status
  |                             |     |     [attendanceRepository.setOvertimeStatus]
  |                             |     |-- Return updated request
  |                             |
  |<-- 200 OK { request } ------------|
  |                                    |
```

---

## 23. Calls (Voice/Video)

### 23.1 Start Call

```
CALLER                           SERVER                         CALLEE
  |                                  |                              |
  |-- ws.send({ type: 'call_start' })|                              |
  |   { callId, targetId,            |                              |
  |     mediaType: 'voice' }          |                              |
  |                                  |                              |
  |                         [CallHandler.handleCallStart]            |
  |                             |-- Validate input                    |
  |                             |-- Check access (conversation/member)|
  |                             |-- Record active call                |
  |                             |     [activeCalls.set]               |
  |                             |-- If user target:                   |
  |                             |     |-- Check if online             |
  |                             |     |     [isUserConnected]          |
  |                             |     |-- If offline:                  |
  |                             |     |     |-- Record missed call     |
  |                             |     |     |     [recordMissedCall]  |
  |                             |     |     |-- Send call_unavailable  |
  |                             |     |     |     [sendToUser]        |
  |                             |     |     |-- Return                |
  |                             |     |-- If online:                   |
  |                             |     |     |-- Send incoming_call     |
  |                             |     |           [sendToUser]        |
  |                                  |                              |
  |                                  |---- { type: 'incoming_call' }->|
  |                                  |     { callId, callerUserId,    |
  |                                  |       callerName, type }        |
  |                                  |                              |
  |                                  |                     [UI shows |
  |                                  |                      incoming |
  |                                  |                      call modal]|
  |                                  |                              |
```

### 23.2 Accept Call

```
CALLEE                           SERVER                         CALLER
  |                                  |                              |
  |-- ws.send({ type: 'call_accept' })|                              |
  |   { callId, callerUserId }        |                              |
  |                                  |                              |
  |                         [CallHandler.handleCallAccept]            |
  |                             |-- Record acceptance                 |
  |                             |     [activeCalls.get(callId)]       |
  |                             |     .accepted.add(calleeId)         |
  |                             |-- Broadcast participants            |
  |                             |     [broadcastParticipants]         |
  |                             |-- Send call_accepted to caller      |
  |                             |     [sendToUser]                    |
  |                                  |                              |
  |                                  |---- { type: 'call_accepted' }->|
  |                                  |     { callId, calleeUserId,    |
  |                                  |       calleeName }              |
  |                                  |                              |
  |                                  |                     [UI shows |
  |                                  |                      call active]|
  |                                  |                              |
  |                                  |                              |
  | (WebRTC Signaling begins)         |                              |
  |                                  |                              |
  |-- ws.send({ type: 'webrtc_offer' })|                             |
  |   { callId, targetUserId, sdp }   |                              |
  |                                  |                              |
  |                         [CallHandler.handleRtcOffer]              |
  |                             |-- Relay to target                  |
  |                             |     [sendToUser]                   |
  |                                  |                              |
  |                                  |---- { type: 'webrtc_offer' }->|
  |                                  |     { callId, sdp }            |
  |                                  |                              |
  |                                  |                     [Callee     |
  |                                  |                      creates     |
  |                                  |                      answer]     |
  |                                  |                              |
  |                                  |<--- { type: 'webrtc_answer' }-|
  |                                  |     { callId, sdp }            |
  |                                  |                              |
  |                         [CallHandler.handleRtcAnswer]             |
  |                             |-- Relay to caller                  |
  |                                  |                              |
  |                                  |---- { type: 'webrtc_answer' }>|
  |                                  |                              |
  | (ICE candidates exchanged)        |                              |
  |                                  |                              |
```

### 23.3 Decline Call

```
CALLEE                           SERVER                         CALLER
  |                                  |                              |
  |-- ws.send({ type: 'call_decline'})|                              |
  |   { callId, callerUserId }        |                              |
  |                                  |                              |
  |                         [CallHandler.handleCallDecline]           |
  |                             |-- Remove active call (1:1)         |
  |                             |-- Send call_declined to caller      |
  |                             |     [sendToUser]                    |
  |                                  |                              |
  |                                  |---- { type: 'call_declined' }>|
  |                                  |     { callId, calleeUserId,    |
  |                                  |       calleeName }              |
  |                                  |                              |
  |                                  |                     [UI shows  |
  |                                  |                      declined]  |
  |                                  |                              |
```

### 23.4 End Call

```
EITHER PARTY                    SERVER                         OTHER
  |                                  |                              |
  |-- ws.send({ type: 'call_end' })  |                              |
  |   { callId }                     |                              |
  |                                  |                              |
  |                         [CallHandler.handleCallEnd]               |
  |                             |-- Remove active call                |
  |                             |-- If 1:1 and not accepted:          |
  |                             |     |-- Record missed call          |
  |                             |           [recordMissedCall]        |
  |                             |-- Send call_ended to other(s)       |
  |                             |     [sendToUser]                    |
  |                                  |                              |
  |                                  |---- { type: 'call_ended' }---->|
  |                                  |     { callId }                 |
  |                                  |                              |
  |                                  |                     [UI closes |
  |                                  |                      call UI]  |
  |                                  |                              |
```

---

## 24. Presence & Typing

### 24.1 User Online Presence

```
USER LOGIN                          SERVER                         ALL CLIENTS
  |                                  |                              |
  |-- ws.connect (with JWT) --------->|                              |
  |                                  |                              |
  |                         [ChatWebSocketServer]                     |
  |                             |-- Register socket                    |
  |                             |     [userConnections.set]            |
  |                             |-- Send connection_ack                 |
  |                                  |                              |
  |<-- { type: 'connection_ack' } ----|                              |
  |<-- { type: 'presence_snapshot' }-|                              |
  |   { data: { userIds: [1,2,3] } }  |                              |
  |                                  |                              |
  |                                  |---- { type: 'user_online' }--->|
  |                                  |     { data: { userId } }       |
  |                                  |                              |
  |                                  |                     [Update    |
  |                                  |                      presence  |
  |                                  |                      indicator]|
  |                                  |                              |
```

### 24.2 User Offline Presence

```
USER LOGOUT / DISCONNECT             SERVER                         ALL CLIENTS
  |                                  |                              |
  |-- ws.close --------------------->|                              |
  |                                  |                              |
  |                         [handleClose]                             |
  |                             |-- Remove from userConnections      |
  |                             |-- If no more connections:          |
  |                                  |                              |
  |                                  |---- { type: 'user_offline' }-->|
  |                                  |     { data: { userId } }       |
  |                                  |                              |
  |                                  |                     [Update    |
  |                                  |                      presence  |
  |                                  |                      indicator]|
  |                                  |                              |
```

### 24.3 Typing Indicator

```
TYPING USER                        SERVER                         OTHER USERS
  |                                  |                              |
  |-- ws.send({ type: 'typing_start'})|                              |
  |   { conversationId: 5 }           |                              |
  |                                  |                              |
  |                         [TypingHandler.handleTypingStart]          |
  |                             |-- Broadcast to other members        |
  |                             |     [broadcastToConversation]       |
  |                                  |                              |
  |                                  |---- { type: 'typing_start' }-->|
  |                                  |     { data: { conversationId, |
  |                                  |              userId } }         |
  |                                  |                              |
  |                                  |                     [Show "X   |
  |                                  |                      is typing"]|
  |                                  |                              |
  | (After 3s inactivity)             |                              |
  |-- ws.send({ type: 'typing_stop' })|                              |
  |                                  |                              |
  |                                  |---- { type: 'typing_stop' }--->|
  |                                  |                              |
  |                                  |                     [Hide     |
  |                                  |                      typing]   |
  |                                  |                              |
```

---

## 25. Search

### 25.1 Global Search

```
CLIENT                              SERVER
  |                                    |
  |-- GET /api/search ---------------->|
  |   ?q=meeting&scope=all             |
  |                                    |
  |                         [searchController.search]
  |                             |-- Authenticate
  |                             |-- [SearchService.globalOverview]
  |                             |     |-- Run parallel queries:
  |                             |     |     [globalSearchRepository.searchMessages]
  |                             |     |     [globalSearchRepository.searchPeople]
  |                             |     |     [globalSearchRepository.searchTeams]
  |                             |     |     [globalSearchRepository.searchChannels]
  |                             |     |     [globalSearchRepository.searchFiles]
  |                             |     |     [globalSearchRepository.searchMeetings]
  |                             |     |     [globalSearchRepository.searchTasks]
  |                             |     |-- Return grouped results
  |                             |           { messages, people, teams,
  |                             |             channels, files, meetings,
  |                             |             tasks }
  |                             |
  |<-- 200 OK { results } ------------|
  |                                    |
```

### 25.2 Search Scope Expansion

```
CLIENT                              SERVER
  |                                    |
  |-- GET /api/search/:scope --------->|
  |   ?q=document&page=1&limit=20      |
  |                                    |
  |                         [SearchService.searchScope]
  |                             |-- Authenticate
  |                             |-- Dispatch to repository:
  |                             |     switch(scope):
  |                             |       'messages' → searchMessages
  |                             |       'people' → searchPeople
  |                             |       'teams' → searchTeams
  |                             |       'channels' → searchChannels
  |                             |       'files' → searchFiles
  |                             |       'meetings' → searchMeetings
  |                             |       'tasks' → searchTasks
  |                             |-- Return paginated results
  |                             |
  |<-- 200 OK { results, pagination }-|
  |                                    |
```

---

## 26. Omni-Channel (Telegram)

### 26.1 Inbound Telegram Message

```
TELEGRAM USER                       SERVER                         AGENTS
  |                                    |                              |
  |-- Sends message to bot ----------->|                              |
  |                                    |                              |
  |                         [TelegramController.webhook]              |
  |                             |-- Validate X-Telegram-Bot-Api-Secret|
  |                             |-- [OmniChannelService.processInbound]|
  |                             |     |-- channel='telegram'          |
  |                             |     |-- [TelegramAdapter.parseInbound]|
  |                             |     |     |-- Parse Telegram update  |
  |                             |     |     |-- Extract text/media    |
  |                             |     |     |-- Normalize to OmniInboundMessage|
  |                             |     |     |-- Return [messages]     |
  |                             |     |                              |
  |                             |     |-- For each message:            |
  |                             |     |     |-- [findOrCreateContact]  |
  |                             |     |     |     |-- Check external_contacts|
  |                             |     |     |     |-- If new:          |
  |                             |     |     |     |     |-- Create shadow user|
  |                             |     |     |     |     |     [userRepository.create]|
  |                             |     |     |     |     |-- Create external_contact|
  |                             |     |     |     |          [externalContactRepository.createContact]|
  |                             |     |     |     |-- Return contact  |
  |                             |     |     |                              |
  |                             |     |     |-- [findOrCreateConversation]|
  |                             |     |     |     |-- Check external_conversations|
  |                             |     |     |     |-- If new:          |
  |                             |     |     |     |     |-- Create internal conversation|
  |                             |     |     |     |     |     [conversationRepository.create]|
  |                             |     |     |     |     |-- Join agents |
  |                             |     |     |     |     |     [joinInboxAgents]|
  |                             |     |     |     |     |-- Create external_conversation|
  |                             |     |     |     |          [externalContactRepository.createConversation]|
  |                             |     |     |     |-- Return conversation|
  |                             |     |     |                              |
  |                             |     |     |-- [createInboundMessage]  |
  |                             |     |     |     |-- Duplicate check    |
  |                             |     |     |     |     [externalContactRepository.findMessageByExternalId]|
  |                             |     |     |     |-- Download media (if any)|
  |                             |     |     |     |     [adapter.downloadMedia]|
  |                             |     |     |     |-- Persist message    |
  |                             |     |     |     |     [messageRepository.create]|
  |                             |     |     |     |-- Create attachment  |
  |                             |     |     |     |     [messageRepository.createAttachment]|
  |                             |     |     |     |-- Create external_message|
  |                             |     |     |     |     [externalContactRepository.createMessage]|
  |                             |     |     |     |-- Create notifications|
  |                             |     |     |     |     [messageService.createMessageNotifications]|
  |                             |     |     |     |-- Return message    |
  |                             |     |     |                              |
  |                             |     |     |-- [broadcastInboundMessage]|
  |                             |     |     |     |-- Send receive_message|
  |                             |     |     |     |     [broadcastToConversation]|
  |                             |     |     |     |-- Send notification events|
  |                             |     |     |     |     [sendToUser]|
  |                             |     |     |                              |
  |                                    |                              |
  |                                    |---- { type: 'receive_message' }->|
  |                                    |     { message, channel: 'telegram' }|
  |                                    |                              |
  |                                    |                     [Agents see|
  |                                    |                      new message|
  |                                    |                      in Omni Inbox]|
  |                                    |                              |
```

### 26.2 Agent Reply (Telegram)

```
AGENT                            SERVER                         TELEGRAM USER
  |                                    |                              |
  |-- POST /api/omni/send ------------->|                              |
  |   { conversationId: 50,             |                              |
  |     text: "Hello!" }                |                              |
  |                                    |                              |
  |                         [OmniChannelService.sendAgentReply]        |
  |                             |-- Find external conversation        |
  |                             |     [externalRepository.findConversationWithContact]|
  |                             |-- Check agent is member             |
  |                             |-- Get adapter (Telegram)            |
  |                             |-- Resolve chatId                   |
  |                             |     (external_contact_id)           |
  |                             |-- Map replyTo (if any)             |
  |                             |-- [adapter.sendMessage]             |
  |                             |     |-- Send to Telegram Bot API    |
  |                             |     |-- Return { ok, externalMessageId }|
  |                             |-- Persist outbound message          |
  |                             |     [messageRepository.create]      |
  |                             |-- Create external_message ledger    |
  |                             |     [externalRepository.createMessage]|
  |                             |-- Broadcast to inbox members       |
  |                             |     [broadcastToConversation]       |
  |                             |-- Create notifications             |
  |                             |     [messageService.createMessageNotifications]|
  |                             |-- Return message                    |
  |                                    |                              |
  |<-- 200 OK { message } ------------|                              |
  |                                    |                              |
  |                                    |---- (via Telegram API) ------->|
  |                                    |                              |
  |                                    |                     [User sees|
  |                                    |                      agent reply]|
  |                                    |                              |
```

### 26.3 Assign/Unassign Conversation

```
AGENT                            SERVER                         ALL AGENTS
  |                                    |                              |
  |-- POST /api/omni/assign ---------->|                              |
  |   { conversationId: 50,             |                              |
  |     agentId: 10 }                   |                              |
  |                                    |                              |
  |                         [OmniChannelService.assignAgent]           |
  |                             |-- Check external conversation       |
  |                             |-- Check requester is member         |
  |                             |-- Check assignee is member (if any) |
  |                             |-- Update assigned_agent_id          |
  |                             |     [externalRepository.updateAssignedAgent]|
  |                             |-- Broadcast omni_assignment_changed |
  |                             |     [broadcastToConversation]       |
  |                                    |                              |
  |<-- 200 OK { conversationId,        |                              |
  |          assignedAgentId } --------|                              |
  |                                    |                              |
  |                                    |---- omni_assignment_changed -->|
  |                                    |     { conversationId,         |
  |                                    |       assignedAgentId }       |
  |                                    |                              |
  |                                    |                     [Update   |
  |                                    |                      assignee  |
  |                                    |                      in UI]    |
  |                                    |                              |
```

---

## 27. Omni-Channel (Website Widget)

### 27.1 Inbound Website Message

```
VISITOR (Website Widget)             SERVER                         AGENTS
  |                                    |                              |
  |-- Submits contact form ----------->|                              |
  |   { name, email, message }         |                              |
  |                                    |                              |
  |                         [WebsiteAdapter.parseInbound]             |
  |                             |-- Normalize to OmniInboundMessage    |
  |                             |     { externalContactId, content }  |
  |                                    |                              |
  |                         [OmniChannelService.processInbound]       |
  |                             |-- channel='website'                  |
  |                             |-- [findOrCreateContact]              |
  |                             |-- [findOrCreateConversation]         |
  |                             |-- [createInboundMessage]             |
  |                             |-- [broadcastInboundMessage]          |
  |                                    |                              |
  |                                    |---- receive_message ----------->|
  |                                    |     { message, channel: 'website' }|
  |                                    |                              |
  |                                    |                     [Agents see|
  |                                    |                      new website|
  |                                    |                      inquiry]  |
  |                                    |                              |
```

### 27.2 Agent Reply (Website)

```
AGENT                            SERVER                         VISITOR
  |                                    |                              |
  |-- POST /api/omni/send ------------->|                              |
  |   { conversationId: 55,             |                              |
  |     text: "How can I help?" }       |                              |
  |                                    |                              |
  |                         [OmniChannelService.sendAgentReply]        |
  |                             |-- [WebsiteAdapter.sendMessage]      |
  |                             |     |-- Stub implementation        |
  |                             |     |-- Returns { ok: true }        |
  |                             |-- Persist + broadcast (same as Telegram)|
  |                                    |                              |
  |<-- 200 OK { message } ------------|                              |
  |                                    |                              |
  |                                    |                     [Message  |
  |                                    |                      appears in|
  |                                    |                      widget]   |
  |                                    |                              |
```

---

## 28. Administration & Permissions

### 28.1 Company Admin Console

```
ADMIN                                SERVER
  |                                    |
  |-- GET /api/company-settings ------>|
  |                                    |
  |                         [companySettingController.get]
  |                             |-- Authenticate
  |                             |-- Authorize (admin+)
  |                             |-- [CompanySettingService.getSettings]
  |                             |     |-- Fetch company settings
  |                             |     |     [companySettingRepository.getByCompany]
  |                             |     |-- Merge with defaults
  |                             |     |-- Return settings
  |                             |
  |<-- 200 OK { settings } -----------|
  |                                    |
```

### 28.2 Update Company Settings

```
ADMIN                                SERVER
  |                                    |
  |-- PATCH /api/company-settings ---->|
  |   { allow_reactions: false,        |
  |     max_upload_size_mb: 20 }       |
  |                                    |
  |                         [companySettingController.update]
  |                             |-- Authenticate
  |                             |-- Authorize (admin+)
  |                             |-- [CompanySettingService.updateSettings]
  |                             |     |-- Validate settings
  |                             |     |-- Persist changes
  |                             |     |     [companySettingRepository.setMany]
  |                             |     |-- Return updated settings
  |                             |
  |<-- 200 OK { settings } -----------|
  |                                    |
```

### 28.3 Permission Matrix

```
ADMIN                                SERVER
  |                                    |
  |-- GET /api/company-settings/permissions ->
  |                                    |
  |                         [companySettingController.getPermissions]
  |                             |-- Authenticate
  |                             |-- Authorize (admin+)
  |                             |-- [PermissionService.getMatrix]
  |                             |     |-- Fetch overrides
  |                             |     |     [rolePermissionRepository.findByCompany]
  |                             |     |-- Merge with baseline
  |                             |     |-- Return matrix
  |                             |
  |<-- 200 OK { matrix } -------------|
  |                                    |
  |                                    |
  |-- POST /api/company-settings/permissions ->
  |   { role: 'manager',               |
  |     permission_key: 'manage_channels',|
  |     allowed: false }               |
  |                                    |
  |                         [companySettingController.setPermission]
  |                             |-- Authenticate
  |                             |-- Authorize (admin+)
  |                             |-- [PermissionService.setOverride]
  |                             |     |-- Validate
  |                             |     |-- Upsert override
  |                             |     |     [rolePermissionRepository.upsert]
  |                             |     |-- Return matrix row
  |                             |
  |<-- 200 OK { matrixRow } ----------|
  |                                    |
```

---

## 29. Background Schedulers

### 29.1 Reminder Processor (every 30s)

```
SERVER (setInterval, 30s)
  |                                    |
  | [reminderService.processDueReminders]
  |                             |-- Find due reminders
  |                             |     [reminderRepository.findDueReminders]
  |                             |-- For each:
  |                             |     |-- Check notification preference
  |                             |     |-- Get message context
  |                             |     |-- Create notification
  |                             |     |     [notificationRepository.create]
  |                             |     |-- Send WebSocket event
  |                             |     |     [sendToUser]
  |                             |     |-- Mark as sent
  |                             |     |     [reminderRepository.markAsSent]
  |                             |
```

### 29.2 Meeting Reminder Processor (every 30s)

```
SERVER (setInterval, 30s)
  |                                    |
  | [meetingService.processDueMeetingReminders]
  |                             |-- Find due meeting reminders
  |                             |     [meetingReminderRepository.findDueReminders]
  |                             |-- For each:
  |                             |     |-- Check meeting is 'scheduled'
  |                             |     |-- Check notification preference
  |                             |     |-- Create notification
  |                             |     |     [notificationRepository.create]
  |                             |     |-- Send WebSocket event
  |                             |     |     [sendToUser]
  |                             |     |     type='meeting_reminder'
  |                             |     |-- Mark as sent
  |                             |     |     [meetingReminderRepository.markAsSent]
  |                             |
```

### 29.3 Task Deadline Processor (every 30s)

```
SERVER (setInterval, 30s)
  |                                    |
  | [taskService.processDueTaskDeadlines]
  |                             |-- Find unreminded due tasks
  |                             |     [taskRepository.findUnremindedDueTasks]
  |                             |-- For each:
  |                             |     |-- Check notification preference
  |                             |     |-- Determine type
  |                             |     |     ('task_deadline' / 'task_overdue')
  |                             |     |-- Create notification
  |                             |     |     [notificationRepository.create]
  |                             |     |-- Send WebSocket event
  |                             |     |     [sendToUser]
  |                             |     |-- Mark as reminded
  |                             |     |     [taskRepository.markDeadlineReminded]
  |                             |
```

### 29.4 Scheduled Announcement Processor (every 30s)

```
SERVER (setInterval, 30s)
  |                                    |
  | [announcementService.processDueScheduledAnnouncements]
  |                             |-- Find due scheduled announcements
  |                             |     [announcementRepository.findDueScheduled]
  |                             |-- For each:
  |                             |     |-- Mark as published
  |                             |     |     [announcementRepository.markPublished]
  |                             |     |-- Notify recipients
  |                             |     |     [notifyRecipients]
  |                             |     |-- Broadcast announcement_created
  |                             |     |     [emitAnnouncementToUsers]
  |                             |     |-- Broadcast notification
  |                             |     |     [emitAnnouncementToUsers]
  |                             |
```

---

## 30. WebSocket Real-Time Pipeline

### 30.1 Connection Lifecycle

```
CLIENT                              SERVER
  |                                    |
  |-- new WebSocket(ws://host?token) ->|
  |                                    |
  |                         [ChatWebSocketServer.attach]
  |                             |-- wss.on('connection')
  |                             |-- Extract token from query
  |                             |-- Verify JWT
  |                             |-- Attach user to socket
  |                             |-- Register in userConnections
  |                             |-- Send connection_ack
  |                             |-- Broadcast user_online
  |                             |-- Send presence snapshot
  |                             |-- Setup message handler
  |                             |-- Setup close handler
  |                             |-- Setup pong handler
  |                                    |
  |<-- connection_ack -----------------|
  |<-- presence_snapshot --------------|
  |                                    |
  | (Heartbeat every 15s)              |
  |-- { type: 'ping' } --------------->|
  |<-- { type: 'pong' } ---------------|
  |                                    |
  | (On disconnect)                    |
  |-- ws.close ----------------------->|
  |                                    |
  |                         [handleClose]
  |                             |-- Remove from userConnections
  |                             |-- If no connections left:
  |                             |     |-- Broadcast user_offline
  |                                    |
```

### 30.2 Event Routing

```
CLIENT EVENT                         SERENT ROUTING
  |                                    |
  |-- ws.send({ type: 'send_message' })|
  |                                    |
  |                         [ChatWebSocketServer.handleMessage]
  |                             |-- Parse JSON
  |                             |-- switch(event.type):
  |                                    |
  |   send_message ----------------> [MessageHandler.handleSendMessage]
  |   forward_message -------------> [MessageHandler.handleForwardMessage]
  |   message_edited ---------------> [MessageHandler.handleMessageEdited]
  |   message_deleted --------------> [MessageHandler.handleMessageDeleted]
  |   message_pinned ---------------> [MessageHandler.handleMessagePinned]
  |   message_unpinned -------------> [MessageHandler.handleMessagePinned]
  |   typing_start -----------------> [TypingHandler.handleTypingStart]
  |   typing_stop ------------------> [TypingHandler.handleTypingStop]
  |   join_channel -----------------> [MessageHandler.handleJoinChannel]
  |   leave_channel ----------------> [MessageHandler.handleLeaveChannel]
  |   call_start -------------------> [CallHandler.handleCallStart]
  |   call_accept ------------------> [CallHandler.handleCallAccept]
  |   call_decline -----------------> [CallHandler.handleCallDecline]
  |   call_end ---------------------> [CallHandler.handleCallEnd]
  |   webrtc_offer -----------------> [CallHandler.handleRtcOffer]
  |   webrtc_answer ----------------> [CallHandler.handleRtcAnswer]
  |   webrtc_ice -------------------> [CallHandler.handleRtcIce]
  |   user_status ------------------> [PresenceHandler.handleUserStatusChange]
  |   ping -------------------------> [Send pong response]
  |                                    |
  |   (default/unknown) -------------> [Send error response]
  |                                    |
```

### 30.3 Cross-Instance Event Relay (Redis)

```
SERVER INSTANCE A                    REDIS                          SERVER INSTANCE B
  |                                    |                              |
  |-- events.publish() --------------->|                              |
  |   { type: 'attendance:clocked_in', |                              |
  |     userIds: [5] }                 |                              |
  |                                    |                              |
  |                         [Redis Pub/Sub]                            |
  |                                    |                              |
  |                                    |---- (subscribe relay) ------->|
  |                                    |                              |
  |                                    |                     [startAttendanceEventRelay]|
  |                                    |                     |-- Parse event|
  |                                    |                     |-- Broadcast to local sockets|
  |                                    |                     |     [sendToUser]|
  |                                    |                              |
  |                                    |                     [User on  |
  |                                    |                      Instance B|
  |                                    |                      receives  |
  |                                    |                      event]    |
  |                                    |                              |
```

---

## Appendix: Feature Dependencies

```
Authentication
  ├── User Management
  │     └── Avatar Upload → WebSocket broadcast
  │
Teams
  ├── Channels
  │     └── Conversations (channel-backed)
  │           └── Messages
  │                 ├── Reactions → WebSocket broadcast
  │                 ├── Pinning → WebSocket broadcast
  │                 ├── Forwarding → WebSocket broadcast
  │                 ├── Reminders → Background scheduler
  │                 └── Bookmarks
  │
  ├── Team Conversations
  │     └── Messages (same as above)
  │
  └── Tasks (team-scoped)
        ├── Comments
        ├── Attachments
        ├── Reactions → WebSocket broadcast
        └── Deadline alerts → Background scheduler

Direct Conversations
  └── Messages (same as above)

Omni-Channel
  ├── Telegram
  │     ├── Inbound → Conversation → Messages
  │     └── Outbound (agent reply) → Telegram API
  └── Website Widget
        ├── Inbound → Conversation → Messages
        └── Outbound (agent reply) → Stub

Meetings
  ├── Attendees → RSVP
  ├── Notes → WebSocket broadcast
  ├── Reminders → Background scheduler
  ├── Attachments
  └── Calendar integration

Attendance
  ├── Work Schedules
  ├── Holidays (overrides attendance)
  ├── Leave Requests (overrides attendance)
  ├── Breaks
  ├── Overtime
  └── Real-time events → Redis → WebSocket

Notifications
  ├── Message mentions → WebSocket
  ├── New messages → WebSocket
  ├── Meeting invites → WebSocket
  ├── Task assignments → WebSocket
  ├── Task deadlines → Background scheduler
  ├── Announcements → WebSocket
  ├── Missed calls → WebSocket
  └── Reminders → Background scheduler

Calls
  ├── Voice/Video signaling → WebSocket
  ├── WebRTC relay (offer/answer/ICE)
  └── Missed call notifications

Search
  ├── Messages
  ├── People
  ├── Teams
  ├── Channels
  ├── Files
  ├── Meetings
  └── Tasks

Administration
  ├── Company Settings → Feature policy
  ├── Permissions → Role matrix
  ├── Subscriptions → Seat limits
  ├── Audit Logs
  └── Platform Metrics
```

---

## Appendix: WebSocket Event Reference

| Event Type | Direction | Payload | Trigger |
|------------|-----------|---------|---------|
| `connection_ack` | Server → Client | `{ userId, message }` | On connect |
| `presence_snapshot` | Server → Client | `{ userIds[] }` | On connect |
| `user_online` | Server → Client | `{ userId }` | User connects |
| `user_offline` | Server → Client | `{ userId }` | User disconnects |
| `user_status_changed` | Server → Client | `{ userId, status }` | Status update |
| `user_profile_updated` | Server → Client | `{ userId, profilePicture }` | Avatar change |
| `send_message` | Client → Server | `{ conversationId, content }` | Send message |
| `message_sent_ack` | Server → Client | `{ data: message }` | Message sent |
| `receive_message` | Server → Client | `{ message }` | New message received |
| `message_updated` | Server → Client | `{ message }` | Message edited |
| `message_deleted` | Server → Client | `{ message }` | Message deleted |
| `message_pinned` | Server → Client | `{ message }` | Message pinned |
| `message_unpinned` | Server → Client | `{ message }` | Message unpinned |
| `message_reacted` | Server → Client | `{ data: { reactions[] } }` | Reaction added |
| `message_unreacted` | Server → Client | `{ data: { reactions[] } }` | Reaction removed |
| `message_forwarded` | Server → Client | `{ message }` | Message forwarded |
| `typing_start` | Bidirectional | `{ conversationId, userId }` | Typing started |
| `typing_stop` | Bidirectional | `{ conversationId, userId }` | Typing stopped |
| `bookmark_added` | Server → Client | `{ data: { messageId } }` | Bookmark added |
| `bookmark_removed` | Server → Client | `{ data: { messageId } }` | Bookmark removed |
| `incoming_call` | Server → Client | `{ callId, caller, type }` | Incoming call |
| `call_accepted` | Server → Client | `{ callId, callee }` | Call accepted |
| `call_declined` | Server → Client | `{ callId, callee }` | Call declined |
| `call_ended` | Server → Client | `{ callId }` | Call ended |
| `call_unavailable` | Server → Client | `{ callId }` | Callee offline |
| `call_participants` | Server → Client | `{ callId, participants[] }` | Participant list |
| `webrtc_offer` | Bidirectional | `{ callId, sdp }` | SDP offer |
| `webrtc_answer` | Bidirectional | `{ callId, sdp }` | SDP answer |
| `webrtc_ice` | Bidirectional | `{ callId, candidate }` | ICE candidate |
| `notification` | Server → Client | `{ data: notification }` | New notification |
| `announcement_created` | Server → Client | `{ data: { announcement } }` | New announcement |
| `announcement_updated` | Server → Client | `{ data: { announcement } }` | Announcement updated |
| `announcement_deleted` | Server → Client | `{ data: { id } }` | Announcement deleted |
| `announcement_reacted` | Server → Client | `{ data: { reactions[] } }` | Announcement reaction |
| `task_reacted` | Server → Client | `{ data: { reactions[] } }` | Task reaction |
| `shared_file_created` | Server → Client | `{ data: { file } }` | File uploaded |
| `shared_file_updated` | Server → Client | `{ data: { file } }` | File updated |
| `shared_file_deleted` | Server → Client | `{ data: { fileId } }` | File deleted |
| `meeting_created` | Server → Client | `{ data: { meeting } }` | Meeting created |
| `meeting_updated` | Server → Client | `{ data: { meeting } }` | Meeting updated |
| `meeting_cancelled` | Server → Client | `{ data: { meeting } }` | Meeting cancelled |
| `meeting_reminder` | Server → Client | `{ data: { meetingId, ... } }` | Meeting reminder |
| `attendance:clocked_in` | Server → Client | `{ data: { record } }` | Clock in |
| `attendance:clocked_out` | Server → Client | `{ data: { record } }` | Clock out |
| `attendance:break_started` | Server → Client | `{ data: { breakId } }` | Break started |
| `attendance:break_ended` | Server → Client | `{ data: { breakId, duration } }` | Break ended |
| `omni_assignment_changed` | Server → Client | `{ data: { conversationId, assignedAgentId } }` | Omni assignment |
| `omni_conversation_status_changed` | Server → Client | `{ data: { conversationId, status } }` | Omni status |
| `workspace_changed` | Server → Client | `{ data: { kind } }` | Teams/channels changed |
| `error` | Server → Client | `{ message }` | Error occurred |
| `pong` | Server → Client | `{ timestamp }` | Heartbeat response |
