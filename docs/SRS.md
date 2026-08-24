# KneaChat — Software Requirements Specification

Workplace Communication & Collaboration Platform

| Item | Details |
| --- | --- |
| Document Version | 2.0 |
| Date | August 2026 |
| Project Status | Proposed |
| Project Type | Web Application |
| Architecture | Client–Server + REST API + WebSocket |
| Frontend Architecture | MVVM |
| Backend Architecture | MVC |
| Programming Paradigm | OOP |
| Frontend | React.js + TypeScript + Tailwind CSS |
| State Management | Zustand |
| Backend | Node.js + Express.js + TypeScript |
| Backend Design | Service Layer + Repository Pattern |
| Database | MySQL |
| Real-Time | Native WebSocket (ws) |
| Authentication | JWT + bcrypt |
| Runtime Management | NVM |
| API Communication | Axios |
| Version Control | Git + GitHub |

## Table of Contents

1. [Introduction](#1-introduction)
2. [Project Overview](#2-project-overview)
3. [Problem Statement](#3-problem-statement)
4. [Project Objectives](#4-project-objectives)
5. [Project Scope](#5-project-scope)
6. [Stakeholders and Target Users](#6-stakeholders-and-target-users)
7. [User Roles and Permissions](#7-user-roles-and-permissions)
8. [User Stories](#8-user-stories)
9. [User Journeys](#9-user-journeys)
10. [Functional Requirements](#10-functional-requirements)
11. [Real-Time Communication Requirements](#11-real-time-communication-requirements)
12. [Non-Functional Requirements](#12-non-functional-requirements)
13. [Technology Stack](#13-technology-stack)
14. [System Architecture](#14-system-architecture)
15. [Frontend Architecture](#15-frontend-architecture)
16. [Backend Architecture](#16-backend-architecture)
17. [State Management](#17-state-management)
18. [Database Requirements](#18-database-requirements)
19. [API Requirements](#19-api-requirements)
20. [WebSocket Requirements](#20-websocket-requirements)
21. [User Interface Requirements](#21-user-interface-requirements)
22. [Security Requirements](#22-security-requirements)
23. [Error Handling and Validation](#23-error-handling-and-validation)
24. [Project Structure](#24-project-structure)
25. [MVP Requirements](#25-mvp-requirements)
26. [Development Roadmap](#26-development-roadmap)
27. [Testing Requirements](#27-testing-requirements)
28. [Acceptance Criteria](#28-acceptance-criteria)
29. [Future Enhancements](#29-future-enhancements)
30. [Risks and Assumptions](#30-risks-and-assumptions)
31. [Architecture Principles](#31-architecture-principles)
32. [Conclusion](#32-conclusion)
33. [Appendix A – ERD](#appendix-a--erd)
34. [Appendix B – Database Schema](#appendix-b--database-schema)
35. [Appendix C – API Flow](#appendix-c--api-flow)
36. [Appendix D – WebSocket Flow](#appendix-d--websocket-flow)

---

## 1. Introduction

### 1.1 Purpose

This Software Requirements Specification defines the functional and non-functional requirements for KneaChat, a web-based workplace communication and collaboration platform.

This document describes:

- System objectives
- Functional requirements
- User roles
- User stories
- User journeys
- System architecture
- Frontend architecture
- Backend architecture
- State management
- Database requirements
- REST API requirements
- WebSocket requirements
- Security requirements
- Testing requirements
- Project structure
- Development roadmap
- Acceptance criteria

The SRS will serve as the primary reference for developers, designers, QA testers, project supervisors, and stakeholders.

### 1.2 Product Name

KneaChat — the name is inspired by the Khmer word "គ្នា", representing togetherness, collaboration, and communication between people.

### 1.3 Tagline

Connect. Communicate. Work Together.

### 1.4 Intended Audience

Developers, project managers, UI/UX designers, QA testers, project supervisors, company administrators, managers, employees, stakeholders.

---

## 2. Project Overview

KneaChat is a workplace communication platform designed to centralize communication between employees, managers, and administrators.

The system supports:

- Direct messaging
- Group conversations
- Teams
- Channels
- Real-time messaging
- Online/offline presence
- Typing indicators
- Notifications
- Message reactions
- Message replies
- Message editing
- Message deletion
- Workplace announcements
- Employee management
- Team management
- Channel management
- Search

```
React + TypeScript
        ↓
REST API + WebSocket
        ↓
Node.js + Express + TypeScript
        ↓
Service Layer
        ↓
Repository Layer
        ↓
MySQL
```

---

## 3. Problem Statement

Organizations may use multiple communication applications for different purposes. This can result in:

- Fragmented communication
- Difficult message searching
- Poor conversation organization
- Missed announcements
- Limited workplace visibility
- Difficult team collaboration
- Lack of centralized employee communication

KneaChat addresses these problems by providing a centralized communication platform.

---

## 4. Project Objectives

### 4.1 Main Objective

To develop a secure, scalable, and user-friendly real-time workplace communication and collaboration platform.

### 4.2 Specific Objectives

The system shall:

- Provide secure authentication.
- Implement role-based access control.
- Support employee profiles.
- Support direct messaging.
- Support group conversations.
- Support teams and channels.
- Provide real-time messaging.
- Provide online/offline presence.
- Provide typing indicators.
- Provide notifications.
- Store message history.
- Support message editing.
- Support message deletion.
- Support message replies.
- Support message reactions.
- Support message search.
- Support workplace announcements.
- Provide administrative management.
- Provide responsive UI.
- Use maintainable and scalable architecture.

---

## 5. Project Scope

### 5.1 In Scope

**Authentication**

- Login
- Logout
- Password reset
- Password change
- JWT authentication
- Session management

**User Management**

- Employee accounts
- User profiles
- Roles
- Departments
- User status
- Account activation/deactivation

**Communication**

- Direct messaging
- Group chat
- Team conversations
- Channels

**Real-Time Communication**

- WebSocket messaging
- Online status
- Offline status
- Typing indicators
- Notifications
- Reconnection

**Message Management**

- Send
- Edit
- Delete
- Reply
- React
- Pin
- Message history
- Attachments

**Administration**

- Employee management
- Role management
- Team management
- Channel management
- Announcements

**Search**

- Search users
- Search messages

### 5.2 Out of Scope for MVP

The following are planned for future versions:

- Video calls
- Voice calls
- Screen sharing
- AI assistant
- Advanced analytics
- Calendar integration
- Third-party integrations
- Advanced enterprise file storage

---

## 6. Stakeholders and Target Users

| Stakeholder | Responsibilities |
| --- | --- |
| Super Admin | Platform-wide administration |
| Company Admin | Manage company/workspace |
| Manager | Manage assigned teams |
| Employee | Workplace communication |
| Developer | System development |
| QA Tester | System testing |
| Project Supervisor | Project review |
| UI/UX Designer | User interface design |

---

## 7. User Roles and Permissions

KneaChat uses four primary roles.

| Role | Description |
| --- | --- |
| Super Admin | Controls the entire KneaChat platform |
| Company Admin | Manages a company/workspace |
| Manager | Manages assigned teams |
| Employee | Regular workplace user |

### 7.1 Permission Matrix

| Feature | Super Admin | Company Admin | Manager | Employee |
| --- | --- | --- | --- | --- |
| Platform settings | ✓ | ✗ | ✗ | ✗ |
| Manage companies | ✓ | ✗ | ✗ | ✗ |
| Manage employees | ✓ | ✓ | Limited | ✗ |
| Manage roles | ✓ | ✓ | ✗ | ✗ |
| Create teams | ✓ | ✓ | ✓ | ✗ |
| Manage team members | ✓ | ✓ | ✓ | ✗ |
| Create channels | ✓ | ✓ | ✓ | According to permission |
| Send messages | ✓ | ✓ | ✓ | ✓ |
| Edit own messages | ✓ | ✓ | ✓ | ✓ |
| Delete own messages | ✓ | ✓ | ✓ | ✓ |
| React to messages | ✓ | ✓ | ✓ | ✓ |
| Search messages | ✓ | ✓ | ✓ | ✓ |
| View profile | ✓ | ✓ | ✓ | ✓ |
| Update own profile | ✓ | ✓ | ✓ | ✓ |

---

## 8. User Stories

| ID | User Story | Priority |
| --- | --- | --- |
| US-01 | As a user, I want to log in securely. | Must Have |
| US-02 | As a user, I want to log out securely. | Must Have |
| US-03 | As a user, I want to reset my password. | Should Have |
| US-04 | As a user, I want to update my profile. | Should Have |
| US-05 | As an employee, I want to see coworker availability. | Must Have |
| US-06 | As an employee, I want to send direct messages. | Must Have |
| US-07 | As an employee, I want to receive messages in real time. | Must Have |
| US-08 | As an employee, I want to edit messages. | Should Have |
| US-09 | As an employee, I want to delete messages. | Should Have |
| US-10 | As an employee, I want to reply to messages. | Should Have |
| US-11 | As an employee, I want to react to messages. | Should Have |
| US-12 | As a manager, I want to create teams. | Must Have |
| US-13 | As a manager, I want to manage team members. | Must Have |
| US-14 | As a manager, I want to create channels. | Must Have |
| US-15 | As a user, I want to join channels. | Must Have |
| US-16 | As a user, I want to see typing indicators. | Should Have |
| US-17 | As a user, I want to receive notifications. | Must Have |
| US-18 | As a user, I want to search for messages. | Should Have |
| US-19 | As an admin, I want to manage employees. | Must Have |
| US-20 | As an admin, I want to manage roles. | Must Have |
| US-21 | As an admin, I want to manage teams. | Must Have |
| US-22 | As an admin, I want to manage channels. | Must Have |
| US-23 | As an admin, I want to disable employee accounts. | Should Have |

---

## 9. User Journeys

### 9.1 Employee

```
Open KneaChat → Login → Dashboard → Select conversation → Read messages → Send message
→ WebSocket → Recipient receives message → Continue communication → Logout
```

### 9.2 Manager

```
Login → Dashboard → My Team → Create/manage team → Add members → Create channel
→ Start discussion → Post announcement → Logout
```

### 9.3 Admin

```
Login → Admin Dashboard → Manage employees → Manage roles → Manage teams
→ Manage channels → Manage settings → Logout
```

---

## 10. Functional Requirements

| ID | Function | Requirement |
| --- | --- | --- |
| FR-01 | Authentication | System shall support login/logout |
| FR-02 | Authorization | System shall enforce RBAC |
| FR-03 | User Management | Authorized users shall manage employees |
| FR-04 | Profile | Users shall manage permitted profile information |
| FR-05 | Company | System shall support companies |
| FR-06 | Department | System shall support departments |
| FR-07 | Teams | Authorized users shall create teams |
| FR-08 | Team Members | Managers/admins shall manage members |
| FR-09 | Channels | Authorized users shall create channels |
| FR-10 | Direct Chat | Users shall communicate privately |
| FR-11 | Group Chat | Users shall communicate in groups |
| FR-12 | Real-Time | Messages shall be delivered through WebSocket |
| FR-13 | Message Edit | Users shall edit permitted messages |
| FR-14 | Message Delete | Users shall delete permitted messages |
| FR-15 | Reply | Users shall reply to messages |
| FR-16 | Reaction | Users shall react to messages |
| FR-17 | Pin | Authorized users shall pin messages |
| FR-18 | Typing | System shall show typing status |
| FR-19 | Presence | System shall maintain user presence |
| FR-20 | Notifications | System shall notify users |
| FR-21 | Mentions | Users shall mention coworkers |
| FR-22 | Search | Users shall search messages/users |
| FR-23 | Attachments | System should support file attachments |
| FR-24 | Announcements | Managers/admins shall publish announcements |
| FR-25 | History | Messages shall persist in MySQL |
| FR-26 | Responsive UI | UI shall support desktop/tablet/mobile |

---

## 11. Real-Time Communication Requirements

WebSocket is a core component of KneaChat.

### 11.1 Events

`connection`, `disconnect`, `send_message`, `receive_message`, `message_updated`, `message_deleted`, `typing_start`, `typing_stop`, `user_online`, `user_offline`, `join_channel`, `leave_channel`, `notification`

### 11.2 Rules

- Only authenticated clients may access protected WebSocket functionality.
- Users can receive events only from authorized conversations.
- Messages must be validated.
- Messages must be persisted.
- Events must be broadcast only to authorized users.
- Client UI must update without page refresh.
- Reconnection should be supported.

---

## 12. Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NFR-01 | Real-time events should have minimal delay |
| NFR-02 | Architecture should support future scaling |
| NFR-03 | System should be available during normal operations |
| NFR-04 | Interface should be easy to understand |
| NFR-05 | Code should be modular |
| NFR-06 | Application should support modern browsers |
| NFR-07 | UI should be responsive |
| NFR-08 | Confirmed messages should not be silently lost |
| NFR-09 | Sensitive data must be protected |
| NFR-10 | TypeScript should be used for type safety |
| NFR-11 | Code should follow consistent formatting |
| NFR-12 | API/database logic should be separated |
| NFR-13 | Frontend and backend should have clear separation of concerns |

---

## 13. Technology Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Frontend | React.js 19 | UI |
| Language | TypeScript | Type safety |
| Frontend Architecture | MVVM | Frontend architecture |
| State Management | Zustand | Global state |
| Styling | Tailwind CSS | UI styling |
| Routing | React Router DOM | Navigation |
| HTTP Client | Axios | REST API |
| WebSocket Client | ws / browser WebSocket | Real-time communication |
| Backend Runtime | Node.js | Server runtime |
| Node Manager | NVM | Node version management |
| Backend | Express.js 5 | REST API |
| Backend Language | TypeScript | Type-safe backend |
| Backend Architecture | MVC | Backend organization |
| Programming | OOP | Classes/interfaces |
| Business Logic | Service Layer | Application logic |
| Data Access | Repository Pattern | Database access |
| WebSocket Server | ws | Real-time communication |
| Database | MySQL | Persistent storage |
| Driver | mysql2 | MySQL connection |
| Authentication | JWT | Authentication |
| Password | bcrypt | Password hashing |
| Testing | Postman | API testing |
| Database Tool | MySQL Workbench | Database administration |
| Version Control | Git/GitHub | Source control |
| Linting | ESLint | Code quality |
| Formatting | Prettier | Formatting |
| Package Manager | npm | Dependencies |
| Editor | VS Code | Development |

---

## 14. System Architecture

KneaChat uses a Client–Server Architecture.

```
                        KneaChat
                              │
             ┌──────────────┴──────────────┐
             │                             │
         FRONTEND                       BACKEND
             │                             │
     React + TypeScript              Node.js + Express
             │                             │
            MVVM                            MVC
             │                             │
        Zustand                           OOP
             │                             │
       API Services                    Controller
             │                             ↓
       WebSocket                    Service Layer
             │                             ↓
             │                         Repository
             │                             ↓
             │                            MySQL
             │
             └──────── WebSocket ──────────┘
```

---

## 15. Frontend Architecture

### 15.1 MVVM

The frontend uses MVVM (Model–View–ViewModel).

**Model** — contains TypeScript interfaces, application types, and API data models. Examples: `User`, `Message`, `Conversation`, `Team`, `Channel`, `Notification`.

**View** — contains React components, pages, forms, chat UI, navigation, and notifications.

**ViewModel** — contains Zustand stores, React hooks, UI/application logic, API calls, and WebSocket interaction.

### 15.2 Frontend Flow

```
User → React View → Hook / ViewModel → Zustand → Service (Axios | WebSocket) → Backend
```

---

## 16. Backend Architecture

The backend uses MVC + OOP + Service Layer + Repository Pattern.

### 16.1 Backend Flow

```
HTTP Request → Route → Controller → Service → Repository → MySQL
```

### 16.2 Controller

Responsible for request handling, response handling, calling services, and basic request validation. Controllers should not contain database queries.

### 16.3 Service

Responsible for business logic, authorization rules, application operations, and coordinating repositories.

### 16.4 Repository

Responsible for MySQL queries, CRUD operations, and data access.

### 16.5 OOP

The backend uses classes, objects, interfaces, encapsulation, abstraction, dependency injection, and composition.

Example:

```
MessageController → MessageService → MessageRepository → MySQL
```

---

## 17. State Management

KneaChat uses Zustand for global frontend state.

### 17.1 Why Zustand?

Zustand provides: a simple API, low boilerplate, TypeScript support, easy React integration, good separation between UI and state, and suitability for real-time chat state.

### 17.2 State Categories

- **Authentication State:** user, isAuthenticated, token, role
- **Chat State:** activeConversation, messages, conversations, selectedMessage
- **Presence State:** onlineUsers, typingUsers, userStatus
- **Notification State:** notifications, unreadCount
- **Team State:** teams, currentTeam, teamMembers
- **Channel State:** channels, currentChannel, channelMembers

---

## 18. Database Requirements

MySQL is the primary database.

### 18.1 Main Entities

`companies`, `departments`, `users`, `teams`, `team_members`, `channels`, `channel_members`, `conversations`, `conversation_members`, `messages`, `message_reactions`, `attachments`, `notifications`, `user_sessions`, `password_resets`

### 18.2 Relationships

```
Company
 ├── Users
 ├── Departments
 └── Teams

Department
 └── Users

Team
 ├── Team Members
 └── Channels

Channel
 └── Channel Members

Conversation
 ├── Members
 └── Messages

Message
 ├── Reactions
 ├── Attachments
 └── Replies

User
 ├── Sessions
 ├── Notifications
 └── Password Resets
```

---

## 19. API Requirements

### 19.1 Authentication

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/refresh`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/change-password`

### 19.2 Users

- `GET    /api/users`
- `GET    /api/users/:id`
- `POST   /api/users`
- `PATCH  /api/users/:id`
- `DELETE /api/users/:id`

### 19.3 Teams

- `GET    /api/teams`
- `POST   /api/teams`
- `GET    /api/teams/:id`
- `PATCH  /api/teams/:id`
- `DELETE /api/teams/:id`

### 19.4 Channels

- `GET    /api/channels`
- `POST   /api/channels`
- `GET    /api/channels/:id`
- `PATCH  /api/channels/:id`
- `DELETE /api/channels/:id`

### 19.5 Conversations

- `GET  /api/conversations`
- `POST /api/conversations`
- `GET  /api/conversations/:id`
- `POST /api/conversations/:id/members`

### 19.6 Messages

- `GET    /api/conversations/:id/messages`
- `POST   /api/messages`
- `PATCH  /api/messages/:id`
- `DELETE /api/messages/:id`

### 19.7 Search

- `GET /api/search/messages`
- `GET /api/search/users`

### 19.8 Notifications

- `GET   /api/notifications`
- `PATCH /api/notifications/:id/read`

---

## 20. WebSocket Requirements

### 20.1 Development Connection

`ws://localhost:8080`

### 20.2 Message Event

```json
{
  "type": "send_message",
  "conversationId": 10,
  "content": "Hello team!"
}
```

### 20.3 Typing Event

```json
{
  "type": "typing_start",
  "conversationId": 10
}
```

### 20.4 Presence Event

```json
{
  "type": "user_online",
  "userId": 5
}
```

### 20.5 Processing

```
WebSocket Connection → Authenticate → Validate Event → Check Permission → Service
→ Repository → MySQL → Broadcast Event
```

---

## 21. User Interface Requirements

### 21.1 Required Pages

**Authentication:** Login, Forgot Password, Reset Password

**Main Application:** Dashboard, Chat, Teams, Channels, Notifications, Profile, Settings

**Administration:** Admin Dashboard, Users, Roles, Teams, Channels, Company settings

---

## 22. Security Requirements

The system shall:

- Hash passwords using bcrypt.
- Never store plain-text passwords.
- Authenticate REST API requests.
- Authenticate WebSocket connections.
- Validate JWT tokens.
- Enforce RBAC.
- Validate user input.
- Use parameterized MySQL queries.
- Configure CORS securely.
- Use rate limiting for sensitive endpoints.
- Validate uploaded files.
- Limit upload size.
- Store secrets in environment variables.
- Use HTTPS/WSS in production.
- Protect sensitive session information.
- Prevent unauthorized conversation access.

---

## 23. Error Handling and Validation

### 23.1 HTTP Status Codes

| Code | Meaning |
| --- | --- |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict |
| 422 | Validation Error |
| 429 | Too Many Requests |
| 500 | Internal Server Error |

### 23.2 Standard Response

```json
{
  "success": false,
  "message": "You do not have permission to perform this action.",
  "errors": {}
}
```

---

## 24. Project Structure

### 24.1 Root

```
KneaChat/
├── client/
├── server/
├── .gitignore
├── README.md
└── package.json
```

### 24.2 Frontend

```
client/
└── src/
    ├── components/
    │   ├── layout/
    │   ├── chat/
    │   ├── message/
    │   ├── team/
    │   ├── channel/
    │   ├── user/
    │   └── notification/
    ├── pages/
    │   ├── auth/
    │   ├── chat/
    │   ├── team/
    │   ├── channel/
    │   ├── profile/
    │   └── admin/
    ├── hooks/
    │   ├── useAuth.ts
    │   ├── useChat.ts
    │   ├── useMessages.ts
    │   └── useWebSocket.ts
    ├── stores/
    │   ├── authStore.ts
    │   ├── chatStore.ts
    │   ├── conversationStore.ts
    │   ├── presenceStore.ts
    │   ├── notificationStore.ts
    │   ├── teamStore.ts
    │   └── channelStore.ts
    ├── services/
    │   ├── api.ts
    │   ├── auth.service.ts
    │   ├── user.service.ts
    │   ├── message.service.ts
    │   ├── conversation.service.ts
    │   └── websocket.service.ts
    ├── types/
    ├── routes/
    ├── utils/
    ├── App.tsx
    └── main.tsx
```

> Note: the shipped client organizes views as `client/src/views/` (Login, Dashboard, Admin, Manager, …) with ViewModels in `client/src/viewmodels/` and Zustand stores in `client/src/store/` — functionally equivalent to the structure above (see `README.md` for the canonical layout).

### 24.3 Backend

```
server/
└── src/
    ├── controllers/
    │   ├── AuthController.ts
    │   ├── UserController.ts
    │   ├── TeamController.ts
    │   ├── ChannelController.ts
    │   ├── ConversationController.ts
    │   ├── MessageController.ts
    │   └── NotificationController.ts
    ├── services/
    │   ├── AuthService.ts
    │   ├── UserService.ts
    │   ├── TeamService.ts
    │   ├── ChannelService.ts
    │   ├── ConversationService.ts
    │   ├── MessageService.ts
    │   └── NotificationService.ts
    ├── repositories/
    │   ├── UserRepository.ts
    │   ├── TeamRepository.ts
    │   ├── ChannelRepository.ts
    │   ├── ConversationRepository.ts
    │   ├── MessageRepository.ts
    │   └── NotificationRepository.ts
    ├── models/
    ├── types/
    ├── routes/
    ├── middleware/
    ├── websocket/
    │   ├── websocket.server.ts
    │   ├── message.handler.ts
    │   ├── presence.handler.ts
    │   ├── typing.handler.ts
    │   └── notification.handler.ts
    ├── database/
    │   ├── database.ts
    │   └── migrations/
    ├── config/
    ├── utils/
    ├── app.ts
    └── server.ts
```

---

## 25. MVP Requirements

| Area | MVP |
| --- | --- |
| Authentication | Login, logout, JWT |
| Users | Profiles, employees, presence |
| Direct Chat | Send/receive messages |
| Group Chat | Group conversations |
| Teams | Create/manage teams |
| Channels | Public/private channels |
| WebSocket | Real-time messaging |
| Presence | Online/offline |
| Typing | Typing indicator |
| History | Persistent messages |
| Message | Edit/delete |
| State | Zustand |
| Security | JWT + bcrypt + RBAC |

---

## 26. Development Roadmap

| Sprint | Focus | Deliverables |
| --- | --- | --- |
| Sprint 1 | Architecture & Foundation | React, TypeScript, Tailwind, MVVM, Zustand, Node, Express, TypeScript, MVC, OOP, Repository, Service Layer, MySQL, WebSocket, NVM |
| Sprint 2 | Authentication | Users, bcrypt, JWT, roles, authorization |
| Sprint 3 | Direct Messaging | Conversations, messages, REST API, WebSocket |
| Sprint 4 | Teams & Channels | Teams, members, channels, group chat |
| Sprint 5 | Real-Time UX | Presence, typing, notifications, reconnect |
| Sprint 6 | Message Features | Edit, delete, reply, reactions, pin, search |
| Sprint 7 | Administration | Users, roles, teams, channels |
| Sprint 8 | Testing & Release | Testing, security, responsive QA, deployment |

---

## 27. Testing Requirements

**Unit Testing** — test services, repositories, utilities, validation.

**API Testing** — test authentication, users, teams, channels, conversations, messages, notifications.

**WebSocket Testing** — test connection, authentication, send message, receive message, typing, presence, reconnection.

**Security Testing** — test invalid JWT, expired JWT, unauthorized access, role restrictions, SQL injection, input validation, file upload restrictions.

---

## 28. Acceptance Criteria

| Area | Acceptance Criteria |
| --- | --- |
| Login | Valid users can log in |
| Logout | Users can securely log out |
| Authorization | Users cannot access unauthorized resources |
| Direct Chat | Two users can communicate |
| Group Chat | Multiple users can communicate |
| Teams | Managers can manage teams |
| Channels | Authorized users can access channels |
| WebSocket | Messages appear without refresh |
| Presence | Status updates correctly |
| Typing | Typing indicator works |
| Notifications | Notifications are generated |
| Messages | Edit/delete/reply/react work |
| Database | Data persists correctly |
| Security | Passwords are hashed |
| Responsive | Core workflows work on supported screens |
| Admin | Administrators can manage required resources |

---

## 29. Future Enhancements

Future versions may include: file sharing, advanced file previews, message threads, voice messages, voice calls, video calls, screen sharing, mobile application, push notifications, calendar integration, third-party integrations, AI assistant, AI conversation summaries, enterprise search, analytics, reporting.

---

## 30. Risks and Assumptions

### 30.1 Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| WebSocket instability | High | Reconnection strategy |
| Unauthorized access | High | Server-side RBAC |
| Message loss | High | Persist before broadcast |
| Database growth | Medium | Indexing and pagination |
| Poor mobile UI | Medium | Responsive design |
| Scope expansion | Medium | MVP prioritization |
| Node version differences | Medium | .nvmrc + NVM |

### 30.2 Assumptions

- Users have network access.
- MySQL is available.
- WebSocket is supported.
- Users have valid workplace accounts.
- The MVP is a web application.
- Advanced features are deferred.

---

## 31. Architecture Principles

KneaChat shall follow the following principles.

### 31.1 Separation of Concerns

Each layer has a specific responsibility.

```
Frontend: View → ViewModel → State / Services
Backend:  Controller → Service → Repository → Database
```

### 31.2 Single Responsibility Principle

Each class/module should have one primary responsibility.

### 31.3 Dependency Injection

Backend dependencies should be injected.

```ts
class MessageService {
  constructor(
    private messageRepository: MessageRepository
  ) {}
}
```

### 31.4 Type Safety

TypeScript should be used throughout the frontend and backend.

### 31.5 Reusability

Reusable components, hooks, services, stores, classes, and utilities should be created where appropriate.

### 31.6 Security by Design

Security must be implemented at the backend rather than relying only on frontend restrictions.

---

## 32. Conclusion

KneaChat is a workplace communication and collaboration platform designed to centralize communication between employees, managers, and administrators.

- **Frontend:** React + TypeScript + MVVM + Zustand + Tailwind CSS
- **Backend:** Node.js + Express + TypeScript + MVC + OOP + Service Layer + Repository Pattern
- **Database:** MySQL
- **Real-Time:** Native WebSocket
- **Authentication:** JWT + bcrypt
- **Runtime:** NVM

The architecture separates presentation, application logic, data access, and persistence responsibilities. This allows KneaChat to remain maintainable while providing a foundation for future scalability.

*KneaChat — Connect. Communicate. Work Together.*

---

## Appendix A – ERD

### A.1 Main Entities

```
companies
    │
    ├────────── departments
    │                │
    │                └──── users
    │
    ├────────── teams
    │              │
    │              ├──── team_members ─── users
    │              │
    │              └──── channels
    │                       │
    │                       └──── channel_members ─── users
    │
    └────────── users

users
  │
  ├──── conversation_members ─── conversations
  │                                  │
  │                                  └──── messages
  │                                           │
  │                                           ├──── message_reactions
  │                                           └──── attachments
  │
  ├──── notifications
  ├──── user_sessions
  └──── password_resets
```

---

## Appendix B – Database Schema

### B.1 Companies

```sql
CREATE TABLE companies (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(150) NOT NULL,
    domain VARCHAR(150) UNIQUE,
    logo VARCHAR(500),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
);
```

### B.2 Departments

```sql
CREATE TABLE departments (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    company_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (company_id)
        REFERENCES companies(id)
);
```

### B.3 Users

```sql
CREATE TABLE users (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,

    company_id BIGINT UNSIGNED NOT NULL,
    department_id BIGINT UNSIGNED NULL,

    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,

    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,

    role ENUM(
        'super_admin',
        'company_admin',
        'manager',
        'employee'
    ) NOT NULL DEFAULT 'employee',

    job_title VARCHAR(150),
    profile_picture VARCHAR(500),

    status ENUM(
        'online',
        'offline',
        'away',
        'dnd'
    ) NOT NULL DEFAULT 'offline',

    is_active TINYINT(1) NOT NULL DEFAULT 1,

    last_seen_at DATETIME NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (company_id)
        REFERENCES companies(id),

    FOREIGN KEY (department_id)
        REFERENCES departments(id),

    INDEX idx_users_company (company_id),
    INDEX idx_users_department (department_id)
);
```

### B.4 Teams

```sql
CREATE TABLE teams (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,

    company_id BIGINT UNSIGNED NOT NULL,
    department_id BIGINT UNSIGNED NULL,

    name VARCHAR(150) NOT NULL,
    description TEXT,

    created_by BIGINT UNSIGNED NOT NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (company_id)
        REFERENCES companies(id),

    FOREIGN KEY (department_id)
        REFERENCES departments(id),

    FOREIGN KEY (created_by)
        REFERENCES users(id)
);
```

### B.5 Team Members

```sql
CREATE TABLE team_members (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,

    team_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,

    role ENUM(
        'leader',
        'member'
    ) NOT NULL DEFAULT 'member',

    joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_team_user (team_id, user_id),

    FOREIGN KEY (team_id)
        REFERENCES teams(id),

    FOREIGN KEY (user_id)
        REFERENCES users(id)
);
```

### B.6 Channels

```sql
CREATE TABLE channels (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,

    company_id BIGINT UNSIGNED NOT NULL,
    team_id BIGINT UNSIGNED NULL,

    created_by BIGINT UNSIGNED NOT NULL,

    name VARCHAR(150) NOT NULL,
    description TEXT,

    type ENUM(
        'public',
        'private'
    ) NOT NULL DEFAULT 'public',

    is_archived TINYINT(1) NOT NULL DEFAULT 0,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (company_id)
        REFERENCES companies(id),

    FOREIGN KEY (team_id)
        REFERENCES teams(id),

    FOREIGN KEY (created_by)
        REFERENCES users(id)
);
```

### B.7 Channel Members

```sql
CREATE TABLE channel_members (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,

    channel_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,

    role ENUM(
        'admin',
        'member'
    ) NOT NULL DEFAULT 'member',

    joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_channel_user (channel_id, user_id),

    FOREIGN KEY (channel_id)
        REFERENCES channels(id),

    FOREIGN KEY (user_id)
        REFERENCES users(id)
);
```

### B.8 Conversations

```sql
CREATE TABLE conversations (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,

    type ENUM(
        'direct',
        'group',
        'channel',
        'team'
    ) NOT NULL,

    created_by BIGINT UNSIGNED NOT NULL,

    name VARCHAR(150),
    description TEXT,

    is_active TINYINT(1) NOT NULL DEFAULT 1,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (created_by)
        REFERENCES users(id)
);
```

> **Note:** the `'team'` conversation type was added to the baseline schema (v2.0) to support the in-scope "Team conversations" requirement (§5.1). A team conversation is one shared room per team; all team members are auto-joined when it is created, and team membership changes are mirrored onto the conversation.

### B.9 Conversation Members

```sql
CREATE TABLE conversation_members (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,

    conversation_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,

    role ENUM(
        'admin',
        'member'
    ) NOT NULL DEFAULT 'member',

    joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_conversation_user
        (conversation_id, user_id),

    FOREIGN KEY (conversation_id)
        REFERENCES conversations(id),

    FOREIGN KEY (user_id)
        REFERENCES users(id)
);
```

### B.10 Messages

```sql
CREATE TABLE messages (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,

    conversation_id BIGINT UNSIGNED NOT NULL,
    sender_id BIGINT UNSIGNED NOT NULL,

    content TEXT NOT NULL,

    type ENUM(
        'text',
        'image',
        'file',
        'system'
    ) NOT NULL DEFAULT 'text',

    reply_to BIGINT UNSIGNED NULL,

    is_pinned TINYINT(1) NOT NULL DEFAULT 0,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    deleted_at DATETIME NULL,

    FOREIGN KEY (conversation_id)
        REFERENCES conversations(id),

    FOREIGN KEY (sender_id)
        REFERENCES users(id),

    FOREIGN KEY (reply_to)
        REFERENCES messages(id),

    INDEX idx_messages_conversation_created
        (conversation_id, created_at),

    INDEX idx_messages_sender
        (sender_id)
);
```

> **Note:** the `is_pinned` column was added to the baseline schema (v2.0) for the pinning feature (FR-17).

### B.11 Message Reactions

```sql
CREATE TABLE message_reactions (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,

    message_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,

    reaction VARCHAR(50) NOT NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_message_user_reaction
        (message_id, user_id, reaction),

    FOREIGN KEY (message_id)
        REFERENCES messages(id),

    FOREIGN KEY (user_id)
        REFERENCES users(id)
);
```

### B.12 Attachments

```sql
CREATE TABLE attachments (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,

    message_id BIGINT UNSIGNED NOT NULL,

    file_name VARCHAR(255) NOT NULL,
    file_url VARCHAR(500) NOT NULL,
    file_type VARCHAR(100),
    file_size BIGINT UNSIGNED,

    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (message_id)
        REFERENCES messages(id)
);
```

### B.13 Notifications

```sql
CREATE TABLE notifications (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,

    user_id BIGINT UNSIGNED NOT NULL,
    actor_id BIGINT UNSIGNED NULL,

    type VARCHAR(100) NOT NULL,

    title VARCHAR(150) NOT NULL,
    message TEXT,

    data JSON NULL,

    is_read TINYINT(1) NOT NULL DEFAULT 0,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(id),

    FOREIGN KEY (actor_id)
        REFERENCES users(id),

    INDEX idx_notifications_user_read
        (user_id, is_read, created_at)
);
```

### B.14 User Sessions

```sql
CREATE TABLE user_sessions (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,

    user_id BIGINT UNSIGNED NOT NULL,

    token_hash VARCHAR(255) NOT NULL,

    device_info VARCHAR(255),
    ip_address VARCHAR(45),

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,

    FOREIGN KEY (user_id)
        REFERENCES users(id),

    INDEX idx_sessions_user_expiry
        (user_id, expires_at)
);
```

### B.15 Password Resets

```sql
CREATE TABLE password_resets (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,

    user_id BIGINT UNSIGNED NOT NULL,

    token VARCHAR(255) NOT NULL,

    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(id),

    INDEX idx_password_reset_user_expiry
        (user_id, expires_at)
);
```

---

## Appendix C – API Flow

Example: Send Message Through REST API

```
React → Axios → POST /api/messages → MessageController → MessageService
→ MessageRepository → MySQL → MessageService → Controller → JSON Response
```

---

## Appendix D – WebSocket Flow

### D.1 Real-Time Message Flow

```
User A → React → WebSocket Client → WebSocket Server → Authenticate
→ Message Handler → MessageService → MessageRepository → MySQL
→ WebSocket Server → Broadcast → User B → Zustand Store → React UI
```

### D.2 Final Technology Architecture

```
┌─────────────────────────────────────────────────────┐
│                     KneaChat                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  FRONTEND                                           │
│                                                     │
│  React + TypeScript + Tailwind CSS                  │
│                 │                                   │
│                MVVM                                 │
│                 │                                   │
│              Zustand                                │
│                 │                                   │
│       Axios + WebSocket                             │
│                                                     │
├────────────────────── REST / WS ────────────────────┤
│                                                     │
│  BACKEND                                            │
│                                                     │
│  Node.js + Express + TypeScript                     │
│                 │                                   │
│                MVC                                  │
│                 │                                   │
│                OOP                                  │
│                 │                                   │
│             Controller                              │
│                 ↓                                   │
│              Service                                │
│                 ↓                                   │
│             Repository                              │
│                 ↓                                   │
│               MySQL                                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```
