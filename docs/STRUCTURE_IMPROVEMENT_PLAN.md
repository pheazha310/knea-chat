# KneaChat — Project Structure Improvement Plan

> **Analysis Date:** 2026-09-14  
> **Purpose:** Concrete, actionable steps to improve code organization, reduce coupling, and enforce consistent patterns  
> **Priority:** High → Medium → Low

---

## Executive Summary

The project has a solid layered architecture (Routes → Controllers → Services → Repositories) and good use of dependency injection. However, several high-severity issues reduce maintainability:

1. **God Component**: `Dashboard.tsx` is 1300+ lines with 20+ state variables
2. **Inconsistent MVVM**: Only chat has a ViewModel; everything else bypasses it
3. **Dual API shape**: Snake_case REST + camelCase WebSocket forces pervasive type casts
4. **Monolithic files**: `chatStore.ts` (865 lines), `wsListeners.ts` (577 lines), `container.ts` (495 lines)
5. **Scattered configuration**: `process.env` accessed in 10+ files with no validation

This document provides a prioritized, step-by-step refactoring plan with code examples.

---

## Phase 1: High-Priority Improvements (Week 1-2)

### 1.1 Break Down `Dashboard.tsx` God Component

**Problem:** `Dashboard.tsx` is 1300+ lines, manages 20+ state variables, and handles 40+ event handlers. It imports 5 stores directly AND uses `useChatViewModel`, creating a confusing mix of patterns.

**Solution:** Extract each sidebar panel into its own component with a dedicated ViewModel.

**Current Structure:**
```
client/src/views/Dashboard.tsx (1300+ lines)
├── useState for conversations, channels, teams, members, etc.
├── useEffect for data fetching
├── Handlers for every action
└── Renders 10+ sidebar panels inline
```

**Target Structure:**
```
client/src/views/Dashboard.tsx (150 lines)
└── Layout shell + routing between panels

client/src/viewmodels/
├── useChatViewModel.ts (existing)
├── useAttendanceViewModel.ts (new)
├── useMeetingViewModel.ts (new)
├── useTaskViewModel.ts (new)
├── useAnnouncementViewModel.ts (new)
├── useNotificationViewModel.ts (new)
└── useOmniInboxViewModel.ts (new)

client/src/components/views/
├── MessagesView.tsx (existing, reduce to 200 lines)
├── AttendanceView.tsx (extract from Dashboard)
├── MeetingsView.tsx (extract from Dashboard)
├── TasksView.tsx (extract from Dashboard)
├── AnnouncementsView.tsx (extract from Dashboard)
├── NotificationsView.tsx (extract from Dashboard)
├── OmniInboxView.tsx (existing, reduce to 250 lines)
└── ProfileView.tsx (extract from Dashboard)
```

**Example: Extract Attendance ViewModel**

```typescript
// client/src/viewmodels/useAttendanceViewModel.ts
import { useCallback, useEffect } from 'react';
import { useAttendanceStore } from '../store/attendanceStore';
import { useAuthStore } from '../store/authStore';

export function useAttendanceViewModel() {
  const { user } = useAuthStore();
  const {
    today,
    month,
    records,
    loading,
    error,
    fetchToday,
    fetchMonth,
    clockIn,
    clockOut,
    startBreak,
    endBreak,
    requestOvertime,
  } = useAttendanceStore();

  useEffect(() => {
    if (user?.id) {
      fetchToday(user.id);
      const now = new Date();
      fetchMonth(user.id, now.getFullYear(), now.getMonth() + 1);
    }
  }, [user?.id, fetchToday, fetchMonth]);

  const handleClockIn = useCallback(async () => {
    if (!user?.id) return;
    await clockIn(user.id);
  }, [user?.id, clockIn]);

  const handleClockOut = useCallback(async () => {
    if (!user?.id) return;
    await clockOut(user.id);
  }, [user?.id, clockOut]);

  return {
    today,
    month,
    records,
    loading,
    error,
    handleClockIn,
    handleClockOut,
    startBreak,
    endBreak,
    requestOvertime,
    refetch: () => {
      if (user?.id) {
        fetchToday(user.id);
      }
    },
  };
}
```

**Example: Simplified Dashboard.tsx**

```typescript
// client/src/views/Dashboard.tsx (BEFORE: 1300 lines, AFTER: 150 lines)
import { useState } from 'react';
import { Sidebar } from '../components/layout/Sidebar';
import { MessagesView } from '../components/views/MessagesView';
import { AttendanceView } from '../components/views/AttendanceView';
import { MeetingsView } from '../components/views/MeetingsView';
import { TasksView } from '../components/views/TasksView';
import { AnnouncementsView } from '../components/views/AnnouncementsView';
import { NotificationsView } from '../components/views/NotificationsView';
import { OmniInboxView } from '../components/views/OmniInboxView';
import { ProfileView } from '../components/views/ProfileView';
import { CallModal } from '../components/modals/CallModal';

type ViewType = 'messages' | 'attendance' | 'meetings' | 'tasks' | 
                'announcements' | 'notifications' | 'omni-inbox' | 'profile';

export default function Dashboard() {
  const [activeView, setActiveView] = useState<ViewType>('messages');

  const renderView = () => {
    switch (activeView) {
      case 'messages': return <MessagesView />;
      case 'attendance': return <AttendanceView />;
      case 'meetings': return <MeetingsView />;
      case 'tasks': return <TasksView />;
      case 'announcements': return <AnnouncementsView />;
      case 'notifications': return <NotificationsView />;
      case 'omni-inbox': return <OmniInboxView />;
      case 'profile': return <ProfileView />;
    }
  };

  return (
    <div className="dashboard">
      <Sidebar activeView={activeView} onNavigate={setActiveView} />
      <main className="dashboard-main">
        {renderView()}
      </main>
      <CallModal />
    </div>
  );
}
```

**Effort:** 2-3 days  
**Impact:** Reduces cognitive load, enables parallel development, makes testing easier

---

### 1.2 Unify API Shape (Snake_case vs CamelCase)

**Problem:** The client receives snake_case from REST (`conversation_id`, `first_name`, `created_at`) but camelCase from WebSocket (`conversationId`, `firstName`, `createdAt`). This forces:
- Dual type definitions (`Message` vs `WsMessage`)
- Pervasive `as any` casts
- Conditional property access: `(m as Message).sender_id ?? (m as { senderId?: number }).senderId`

**Solution:** Normalize all API responses to camelCase on the client side.

**Step 1: Create API Response Transformer**

```typescript
// client/src/services/response.ts
export function normalizeKeys(obj: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(obj)) {
    return obj.map(normalizeKeys);
  }
  if (obj instanceof Date) return obj;
  
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = value instanceof Object && !(value instanceof Date)
      ? normalizeKeys(value as Record<string, unknown>)
      : value;
  }
  return result;
}

export async function normalizedFetch<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json();
  return normalizeKeys(data) as T;
}
```

**Step 2: Apply in Axios Interceptor**

```typescript
// client/src/services/api.ts
import { normalizeKeys } from './response';

const api = axios.create({ baseURL: API_URL });

api.interceptors.response.use((response) => {
  if (response.data?.data) {
    response.data.data = normalizeKeys(response.data.data);
  }
  return response;
});

export default api;
```

**Step 3: Unify Message Types**

```typescript
// BEFORE: client/src/models/Message.ts
export interface MessageRow {
  id: number;
  conversation_id: number;
  sender_id: number;
  content: string;
  created_at: string;
  // ... 20+ snake_case fields
}

export interface WsMessage {
  id: number;
  conversationId: number;
  senderId: number;
  content: string;
  createdAt: string;
  // ... camelCase fields
}

// AFTER: Unify to one type
export interface Message {
  id: number;
  conversationId: number;
  senderId: number;
  content: string;
  createdAt: string;
  // ... all camelCase
}
```

**Step 4: Remove Dual-Type Casts**

```typescript
// BEFORE: client/src/store/chatStore.ts
const senderId = (m as Message).sender_id ?? (m as { senderId?: number }).senderId;

// AFTER:
const senderId = message.senderId;
```

**Effort:** 1-2 days  
**Impact:** Eliminates hundreds of type casts, makes code more readable

---

### 1.3 Centralize Configuration

**Problem:** `process.env.*` is accessed in 10+ files with no validation. The same default values are repeated.

**Files with scattered config:**
- `server/src/middleware/auth.middleware.ts` — `JWT_SECRET`
- `server/src/websocket/websocket.server.ts` — `JWT_SECRET` (duplicate)
- `server/src/utils/auth.utils.ts` — `JWT_SECRET` (duplicate)
- `server/src/database/connection.ts` — `DB_HOST`, `DB_PORT`, `DB_USER`, etc.
- `server/src/app.ts` — `CORS_ORIGIN`, `PORT`, `HOST`
- `server/src/cache/redisClient.ts` — `REDIS_URL`

**Solution:** Create a validated config module.

```typescript
// server/src/config.ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default('localhost'),
  
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(3306),
  DB_USER: z.string().default('root'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().default('kneachat'),
  
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRY: z.string().default('24h'),
  
  CORS_ORIGIN: z.string().default('http://localhost:3000,http://localhost:3001'),
  
  REDIS_URL: z.string().optional(),
  UPLOAD_DIR: z.string().default('uploads'),
  
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  
  OMNI_INBOX_AGENT_IDS: z.string().optional(),
});

export const config = envSchema.parse(process.env);

// Usage:
// import { config } from './config';
// config.JWT_SECRET
// config.DB_HOST
```

**Then replace all `process.env.*` with `config.*`:**

```typescript
// BEFORE: server/src/middleware/auth.middleware.ts
const getSecret = (): string => process.env.JWT_SECRET || 'your-secret-key';

// AFTER:
import { config } from '../config';
const getSecret = (): string => config.JWT_SECRET;
```

**Effort:** 1 day  
**Impact:** Single source of truth, validation at startup, eliminates duplication

---

## Phase 2: Medium-Priority Improvements (Week 3-4)

### 2.1 Split Monolithic Files

#### 2.1.1 Split `chatStore.ts` (865 lines)

**Problem:** One store manages conversations, messages, typing, presence, bookmarks, reminders, and connection status.

**Solution:** Split by domain.

```
client/src/store/
├── chatStore.ts (REMOVE)
├── conversationStore.ts (NEW)
│   └── conversations list, active conversation, members
├── messageStore.ts (NEW)
│   └── message cache, send/edit/delete/forward/pin/react
├── typingStore.ts (NEW)
│   └── typing users per conversation
├── presenceStore.ts (NEW)
│   └── online users, user status
├── bookmarkStore.ts (NEW)
│   └── bookmarked message IDs
├── reminderStore.ts (NEW)
│   └── message reminders
└── connectionStore.ts (NEW)
    └── WebSocket connection status
```

**Example: `messageStore.ts`**

```typescript
// client/src/store/messageStore.ts
import { create } from 'zustand';
import type { Message } from '../models';

interface MessageState {
  messages: Map<number, Message[]>; // conversationId → messages
  loading: Map<number, boolean>;
  
  getMessages: (conversationId: number) => Message[];
  addMessage: (conversationId: number, message: Message) => void;
  updateMessage: (conversationId: number, messageId: number, content: string) => void;
  deleteMessage: (conversationId: number, messageId: number) => void;
  pinMessage: (conversationId: number, messageId: number, pinned: boolean) => void;
  setMessages: (conversationId: number, messages: Message[]) => void;
  clearMessages: (conversationId: number) => void;
}

export const useMessageStore = create<MessageState>((set, get) => ({
  messages: new Map(),
  loading: new Map(),

  getMessages: (conversationId) => get().messages.get(conversationId) || [],

  addMessage: (conversationId, message) => {
    const messages = new Map(get().messages);
    const existing = messages.get(conversationId) || [];
    messages.set(conversationId, [...existing, message]);
    set({ messages });
  },

  updateMessage: (conversationId, messageId, content) => {
    const messages = new Map(get().messages);
    const existing = messages.get(conversationId) || [];
    messages.set(conversationId, 
      existing.map(m => m.id === messageId ? { ...m, content, updatedAt: new Date().toISOString() } : m)
    );
    set({ messages });
  },

  deleteMessage: (conversationId, messageId) => {
    const messages = new Map(get().messages);
    const existing = messages.get(conversationId) || [];
    messages.set(conversationId, existing.filter(m => m.id !== messageId));
    set({ messages });
  },

  pinMessage: (conversationId, messageId, pinned) => {
    const messages = new Map(get().messages);
    const existing = messages.get(conversationId) || [];
    messages.set(conversationId,
      existing.map(m => m.id === messageId ? { ...m, isPinned: pinned } : m)
    );
    set({ messages });
  },

  setMessages: (conversationId, messages) => {
    const all = new Map(get().messages);
    all.set(conversationId, messages);
    set({ messages: all });
  },

  clearMessages: (conversationId) => {
    const messages = new Map(get().messages);
    messages.delete(conversationId);
    set({ messages });
  },
}));
```

#### 2.1.2 Split `wsListeners.ts` (577 lines)

**Problem:** One file subscribes to 40+ WebSocket events and dispatches to 10+ stores.

**Solution:** Split by domain.

```
client/src/store/
├── wsListeners.ts (REMOVE - split into:)
├── chatWsListeners.ts
│   ├── receive_message
│   ├── message_sent_ack
│   ├── message_updated/deleted
│   ├── message_pinned/unpinned
│   ├── message_reacted/unreacted
│   ├── typing_start/stop
│   └── bookmark_added/removed
├── presenceWsListeners.ts
│   ├── user_online/offline
│   ├── presence_snapshot
│   ├── user_status_changed
│   └── user_profile_updated
├── callWsListeners.ts
│   ├── incoming_call
│   ├── call_accepted/declined/ended
│   ├── call_participants
│   └── webrtc_offer/answer/ice
├── meetingWsListeners.ts
│   ├── meeting_created/updated/cancelled
│   ├── meeting_note_added/updated/deleted
│   ├── meeting_reminder_set/deleted
│   └── meeting_attendee_updated/added
├── notificationWsListeners.ts
│   ├── notification
│   ├── announcement_created/updated/deleted
│   └── task_reacted/unreacted
└── attendanceWsListeners.ts
    ├── attendance:clocked_in/out
    ├── attendance:break_started/ended
    └── attendance:status_changed
```

**Example: `chatWsListeners.ts`**

```typescript
// client/src/store/chatWsListeners.ts
import { wsService } from '../services/websocket';
import { useMessageStore } from './messageStore';
import { useTypingStore } from './typingStore';
import { useBookmarkStore } from './bookmarkStore';
import { useNotificationStore } from './notificationStore';
import { toNumber } from './utils';

export function registerChatWsListeners(): () => void {
  const unsubs: Array<() => void> = [];

  unsubs.push(
    wsService.on('receive_message', (payload) => {
      const convId = toNumber(payload.message.conversationId);
      if (convId === null) return;
      useMessageStore.getState().addMessage(convId, payload.message);
    }),
  );

  unsubs.push(
    wsService.on('message_updated', (payload) => {
      const convId = toNumber(payload.message.conversationId);
      if (convId === null) return;
      useMessageStore.getState().updateMessage(
        convId,
        payload.message.id,
        payload.message.content
      );
    }),
  );

  unsubs.push(
    wsService.on('message_deleted', (payload) => {
      const convId = toNumber(payload.message.conversationId);
      if (convId === null) return;
      useMessageStore.getState().deleteMessage(convId, payload.message.id);
    }),
  );

  unsubs.push(
    wsService.on('message_pinned', (payload) => {
      const convId = toNumber(payload.message.conversationId);
      if (convId === null) return;
      useMessageStore.getState().pinMessage(convId, payload.message.id, true);
    }),
  );

  unsubs.push(
    wsService.on('message_reacted', (payload) => {
      const convId = toNumber(payload.data.conversationId);
      if (convId === null) return;
      useMessageStore.getState().applyReactions(
        convId,
        payload.data.messageId,
        payload.data.reactions
      );
    }),
  );

  unsubs.push(
    wsService.on('typing_start', (payload) => {
      const { conversationId, userId } = payload.data;
      useTypingStore.getState().setTyping(conversationId, userId, true);
    }),
  );

  unsubs.push(
    wsService.on('typing_stop', (payload) => {
      const { conversationId, userId } = payload.data;
      useTypingStore.getState().setTyping(conversationId, userId, false);
    }),
  );

  unsubs.push(
    wsService.on('bookmark_added', (payload) => {
      const messageId = toNumber(payload?.data?.messageId);
      if (messageId === null) return;
      useBookmarkStore.getState().add(messageId);
    }),
  );

  return () => unsubs.forEach(unsub => unsub());
}
```

**Then update `App.tsx`:**

```typescript
// client/src/App.tsx
import { registerChatWsListeners } from './store/chatWsListeners';
import { registerPresenceWsListeners } from './store/presenceWsListeners';
import { registerCallWsListeners } from './store/callWsListeners';
import { registerMeetingWsListeners } from './store/meetingWsListeners';
import { registerNotificationWsListeners } from './store/notificationWsListeners';
import { registerAttendanceWsListeners } from './store/attendanceWsListeners';

export default function App() {
  // ...
  
  useEffect(() => {
    const unsubs = [
      registerChatWsListeners(),
      registerPresenceWsListeners(),
      registerCallWsListeners(),
      registerMeetingWsListeners(),
      registerNotificationWsListeners(),
      registerAttendanceWsListeners(),
    ];
    return () => unsubs.forEach(unsub => unsub());
  }, []);
}
```

**Effort:** 2 days  
**Impact:** Each file under 200 lines, easier to test, clear ownership

---

#### 2.1.3 Split `container.ts` (495 lines)

**Problem:** All 100+ dependency bindings in one file. Adding a feature requires editing this monolith.

**Solution:** Split into per-module wiring files.

```
server/src/
├── container.ts (thin orchestrator, 50 lines)
├── container.chat.ts (messages, conversations, channels, teams)
├── container.attendance.ts (attendance, leave, holidays, schedules)
├── container.meetings.ts (meetings, notes, reminders, attendees)
├── container.tasks.ts (tasks, comments, attachments, reactions)
├── container.announcements.ts (announcements, reactions, reads)
├── container.omni.ts (omni-channel, telegram, website)
├── container.admin.ts (users, companies, departments, audit, settings)
├── container.files.ts (shared files, versions, permissions)
└── container.notifications.ts (notifications, preferences)
```

**Example: `container.chat.ts`**

```typescript
// server/src/container.chat.ts
import { MessageRepository } from '../repositories/messageRepository';
import { ConversationRepository } from '../repositories/conversationRepository';
import { ChannelRepository } from '../repositories/channelRepository';
import { ChannelMemberRepository } from '../repositories/channelMemberRepository';
import { TeamRepository } from '../repositories/teamRepository';
import { TeamMemberRepository } from '../repositories/teamMemberRepository';
import { UserRepository } from '../repositories/userRepository';
import { ReactionRepository } from '../repositories/reactionRepository';
import { BookmarkRepository } from '../repositories/bookmarkRepository';
import { ReminderRepository } from '../repositories/reminderRepository';
import { NotificationRepository } from '../repositories/notificationRepository';
import { ExternalContactRepository } from '../repositories/externalContactRepository';
import { NotificationPreferenceService } from '../services/NotificationPreference.service';
import { MessageService } from '../services/Message.service';
import { ConversationService } from '../services/Conversation.service';
import { ChannelService } from '../services/Channel.service';
import { TeamService } from '../services/Team.service';
import { ReminderService } from '../services/Reminder.service';
import { BookmarkService } from '../services/Bookmark.service';
import { NotificationService } from '../services/Notification.service';
import { MessageController } from '../controllers/message.controller';
import { ConversationController } from '../controllers/conversation.controller';
import { ChannelController } from '../controllers/channel.controller';
import { TeamController } from '../controllers/team.controller';
import { ReminderController } from '../controllers/reminder.controller';
import { BookmarkController } from '../controllers/bookmark.controller';
import { createMessageRouter } from '../routes/message.routes';
import { createConversationRouter } from '../routes/conversation.routes';
import { createChannelRouter } from '../routes/channel.routes';
import { createTeamRouter } from '../routes/team.routes';
import { createReminderRouter } from '../routes/reminder.routes';
import { createBookmarkMessageRouter, createBookmarkListRouter } from '../routes/bookmark.routes';
import type { BroadcastToConversation } from '../websocket/broadcast.utils';
import { createBroadcastToConversation } from '../websocket/broadcast.utils';
import type { Container } from './container';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export function wireChat(container: Container, auth: AuthMiddleware) {
  const db = container.db;
  
  // Repositories
  const messageRepository = new MessageRepository(db);
  const conversationRepository = new ConversationRepository(db);
  const channelRepository = new ChannelRepository(db);
  const channelMemberRepository = new ChannelMemberRepository(db);
  const teamRepository = new TeamRepository(db);
  const teamMemberRepository = new TeamMemberRepository(db);
  const userRepository = container.userRepository;
  const reactionRepository = new ReactionRepository(db);
  const bookmarkRepository = new BookmarkRepository(db);
  const reminderRepository = new ReminderRepository(db);
  const notificationRepository = container.notificationRepository;
  const externalContactRepository = new ExternalContactRepository(db);

  // Services
  const notificationPreferenceService = container.notificationPreferenceService;
  const messageService = new MessageService(
    messageRepository,
    reactionRepository,
    conversationRepository,
    notificationRepository,
    notificationPreferenceService,
    externalContactRepository,
  );
  const conversationService = new ConversationService(
    conversationRepository,
    messageRepository,
    userRepository,
    channelRepository,
    channelMemberRepository,
    teamRepository,
    teamMemberRepository,
    externalContactRepository,
  );
  const channelService = new ChannelService(
    channelRepository,
    channelMemberRepository,
    teamMemberRepository,
    conversationRepository,
    container.permissionService,
  );
  const teamService = new TeamService(
    teamRepository,
    teamMemberRepository,
    conversationRepository,
    container.permissionService,
  );
  const reminderService = new ReminderService(
    reminderRepository,
    notificationRepository,
    messageRepository,
    notificationPreferenceService,
  );
  const bookmarkService = new BookmarkService(
    bookmarkRepository,
    messageRepository,
    conversationRepository,
  );
  const notificationService = new NotificationService(
    notificationRepository,
    messageRepository,
    container.announcementRepository,
    container.taskRepository,
  );

  // Broadcast utility
  const broadcastToConversation = createBroadcastToConversation(conversationRepository);

  // Controllers
  const messageController = new MessageController(
    messageService,
    container.systemSettingService,
    broadcastToConversation,
    container.companySettingService,
  );
  const conversationController = new ConversationController(
    conversationService,
    conversationRepository,
    messageService,
  );
  const channelController = new ChannelController(channelService);
  const teamController = new TeamController(teamService, container.auditLogService);
  const reminderController = new ReminderController(reminderService);
  const bookmarkController = new BookmarkController(bookmarkService);

  return {
    // Services
    messageService,
    conversationService,
    channelService,
    teamService,
    reminderService,
    bookmarkService,
    notificationService,
    broadcastToConversation,
    // Controllers
    messageController,
    conversationController,
    channelController,
    teamController,
    reminderController,
    bookmarkController,
    // Routes
    messageRouter: createMessageRouter(messageController, auth),
    conversationRouter: createConversationRouter(conversationController, auth),
    channelRouter: createChannelRouter(channelController, auth),
    teamRouter: createTeamRouter(teamController, auth),
    reminderRouter: createReminderRouter(reminderController, auth),
    bookmarkMessageRouter: createBookmarkMessageRouter(bookmarkController, auth),
    bookmarkListRouter: createBookmarkListRouter(bookmarkController, auth),
  };
}
```

**Then `container.ts` becomes:**

```typescript
// server/src/container.ts (BEFORE: 495 lines, AFTER: 50 lines)
import { db } from './database/connection';
import { wireChat } from './container.chat';
import { wireAttendance } from './container.attendance';
import { wireMeetings } from './container.meetings';
import { wireTasks } from './container.tasks';
import { wireAnnouncements } from './container.announcements';
import { wireOmni } from './container.omni';
import { wireAdmin } from './container.admin';
import { wireFiles } from './container.files';
import { wireNotifications } from './container.notifications';
import { createAuthMiddleware } from './middleware/auth.middleware';

export const container = {
  db,
  ...wireChat(container),
  ...wireAttendance(container),
  ...wireMeetings(container),
  ...wireTasks(container),
  ...wireAnnouncements(container),
  ...wireOmni(container),
  ...wireAdmin(container),
  ...wireFiles(container),
  ...wireNotifications(container),
};

export const auth = createAuthMiddleware(
  container.systemSettingService,
  container.permissionService,
);

export type Container = typeof container;
```

**Effort:** 2-3 days  
**Impact:** Easier to navigate, enables parallel feature development, clearer ownership

---

### 2.2 Standardize Controller Error Handling

**Problem:** Controllers use inconsistent error handling:
- `AttendanceController` uses `next(error)`
- `AuthController` catches and returns JSON directly
- Some return `{ success, message, data }`, others return raw data

**Solution:** Create a base controller with a `handle` wrapper.

```typescript
// server/src/controllers/base.controller.ts
import type { NextFunction, Request, Response, RequestHandler } from 'express';

export abstract class BaseController {
  protected handle(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        await fn(req, res, next);
      } catch (error) {
        next(error);
      }
    };
  }

  protected ok<T>(res: Response, data: T, message?: string) {
    return res.json({
      success: true,
      message,
      data,
    });
  }

  protected created<T>(res: Response, data: T, message?: string) {
    return res.status(201).json({
      success: true,
      message,
      data,
    });
  }

  protected noContent(res: Response) {
    return res.status(204).send();
  }
}
```

**Then in child controllers:**

```typescript
// BEFORE: server/src/controllers/attendance.controller.ts
export class AttendanceController {
  constructor(private service: AttendanceService) {}

  async clockIn(req: Request, res: Response, next: NextFunction) {
    try {
      const record = await this.service.clockIn(req.user!.id);
      return res.json({ success: true, data: record });
    } catch (error) {
      next(error);
    }
  }
}

// AFTER:
export class AttendanceController extends BaseController {
  constructor(private service: AttendanceService) {
    super();
  }

  clockIn = this.handle(async (req, res) => {
    const record = await this.service.clockIn(req.user!.id);
    this.ok(res, record);
  });
}
```

**Effort:** 1 day  
**Impact:** Consistent response format, less boilerplate

---

### 2.3 Split `WsEventMap` by Domain

**Problem:** `WsEventMap` is a 340-line type that grows with every new feature.

**Solution:** Split into domain-specific event maps.

```typescript
// client/src/services/websocket.events.ts

// Chat events
export interface ChatEventMap {
  'send_message': { type: 'send_message'; conversationId: number; content: string };
  'receive_message': { type: 'receive_message'; message: WsMessage };
  'message_sent_ack': { type: 'message_sent_ack'; data: WsMessage };
  'message_updated': { type: 'message_updated'; message: { id: number; conversationId: number; content: string } };
  'message_deleted': { type: 'message_deleted'; message: { id: number; conversationId: number } };
  'message_pinned': { type: 'message_pinned'; message: { id: number; conversationId: number; isPinned: boolean } };
  'message_unpinned': { type: 'message_unpinned'; message: { id: number; conversationId: number; isPinned: boolean } };
  'message_reacted': { type: 'message_reacted'; data: { conversationId: number; messageId: number; reactions: Reaction[] } };
  'message_unreacted': { type: 'message_unreacted'; data: { conversationId: number; messageId: number; reactions: Reaction[] } };
  'typing_start': { type: 'typing_start'; data: TypingData };
  'typing_stop': { type: 'typing_stop'; data: TypingData };
}

// Presence events
export interface PresenceEventMap {
  'user_online': { type: 'user_online'; data: PresenceData };
  'user_offline': { type: 'user_offline'; data: PresenceData };
  'presence_snapshot': { type: 'presence_snapshot'; data: { userIds: number[] } };
  'user_status_changed': { type: 'user_status_changed'; data: PresenceData & { status: string } };
  'user_profile_updated': { type: 'user_profile_updated'; data: { userId: number; profilePicture: string | null } };
}

// Call events
export interface CallEventMap {
  'incoming_call': { type: 'incoming_call'; data: CallData };
  'call_accepted': { type: 'call_accepted'; data: { callId: string; calleeUserId: number; calleeName: string } };
  'call_declined': { type: 'call_declined'; data: { callId: string; calleeUserId: number; calleeName: string } };
  'call_ended': { type: 'call_ended'; data: { callId: string } };
  'call_unavailable': { type: 'call_unavailable'; data: { callId: string } };
  'call_participants': { type: 'call_participants'; data: { callId: string; participants: Array<{ userId: number; name: string }> } };
  'webrtc_offer': { type: 'webrtc_offer'; data: { callId: string; targetUserId: number; sdp: RTCSessionDescriptionInit } };
  'webrtc_answer': { type: 'webrtc_answer'; data: { callId: string; targetUserId: number; sdp: RTCSessionDescriptionInit } };
  'webrtc_ice': { type: 'webrtc_ice'; data: { callId: string; targetUserId: number; candidate: RTCIceCandidateInit } };
}

// Meeting events
export interface MeetingEventMap {
  'meeting_created': { type: 'meeting_created'; data: { meeting: any } };
  'meeting_updated': { type: 'meeting_updated'; data: { meeting: any } };
  'meeting_cancelled': { type: 'meeting_cancelled'; data: { meeting: { id: number } } };
  'meeting_note_added': { type: 'meeting_note_added'; data: { note: any; meetingId: number } };
  'meeting_reminder': { type: 'meeting_reminder'; data: { meetingId: number; title: string; startTime: string } };
}

// Attendance events
export interface AttendanceEventMap {
  'attendance:clocked_in': { type: 'attendance:clocked_in'; data: { record: any; date: string } };
  'attendance:clocked_out': { type: 'attendance:clocked_out'; data: { record: any; date: string } };
  'attendance:break_started': { type: 'attendance:break_started'; data: { breakId: number; attendanceId: number } };
  'attendance:break_ended': { type: 'attendance:break_ended'; data: { breakId: number; durationMinutes: number } };
}

// Compose them
export type WsEventMap = ChatEventMap & PresenceEventMap & CallEventMap & 
                         MeetingEventMap & AttendanceEventMap & {
  'notification': { type: 'notification'; data?: any };
  'announcement_created': { type: 'announcement_created'; data: { announcement: Announcement } };
  'announcement_updated': { type: 'announcement_updated'; data: { announcement: Announcement } };
  'announcement_deleted': { type: 'announcement_deleted'; data: { id: number } };
  'announcement_reacted': { type: 'announcement_reacted'; data: { announcementId: number; reactions: Reaction[] } };
  'task_reacted': { type: 'task_reacted'; data: { taskId: number; reactions: Reaction[] } };
  'shared_file_created': { type: 'shared_file_created'; data: { file: SharedFile } };
  'shared_file_updated': { type: 'shared_file_updated'; data: { file: SharedFile } };
  'shared_file_deleted': { type: 'shared_file_deleted'; data: { fileId: number } };
  'workspace_changed': { type: 'workspace_changed'; data: { kind: 'teams' | 'channels' } };
  'error': { type: 'error'; message: string };
};
```

**Effort:** 1 day  
**Impact:** Easier to navigate, better documentation, type safety per domain

---

### 2.4 Standardize Test Organization

**Problem:** Server tests are flat in `server/test/`, client tests are co-located in `client/src/`.

**Solution:** Mirror server source structure.

```
server/
├── src/
│   └── ... (source)
├── test/
│   ├── helpers/
│   │   ├── module-stub.ts
│   │   ├── db.ts
│   │   └── ws.ts
│   ├── unit/
│   │   ├── services/
│   │   │   ├── attendance.service.test.ts
│   │   │   ├── announcement.service.test.ts
│   │   │   ├── telegram.service.test.ts
│   │   │   └── ...
│   │   ├── repositories/
│   │   │   ├── messageRepository.test.ts
│   │   │   └── ...
│   │   └── utils/
│   │       ├── roles.test.ts
│   │       └── ...
│   ├── integration/
│   │   ├── auth.integration.test.ts
│   │   ├── message.integration.test.ts
│   │   └── ...
│   └── e2e/
│       ├── notifications.e2e.js
│       ├── attendance.e2e.js
│       └── ...
```

**Migration steps:**
1. Create new directories under `test/`
2. Move existing test files to matching subdirectories
3. Update import paths in test files
4. Update `package.json` test scripts

**Effort:** 1 day  
**Impact:** Easier to find tests, clearer ownership

---

## Phase 3: Low-Priority Improvements (Week 5+)

### 3.1 Rename Route Files to Match URLs

```typescript
// BEFORE (camelCase, doesn't match URL):
server/src/routes/
├── companySetting.routes.ts  → URL: /api/company-settings
├── notificationPreference.routes.ts → URL: /api/notification-preferences
├── leaveRequest.routes.ts → URL: /api/leave-requests
└── platformMetric.routes.ts → URL: /api/admin/metrics

// AFTER (kebab-case, matches URL):
server/src/routes/
├── company-settings.routes.ts
├── notification-preferences.routes.ts
├── leave-requests.routes.ts
└── admin/
    └── metrics.routes.ts
```

**Effort:** 1 hour  
**Impact:** Consistency between file names and URLs

---

### 3.2 Add Barrel Exports to `server/src`

```typescript
// server/src/index.ts
// Repositories
export { default as db } from './database/connection';
export * from './repositories/userRepository';
export * from './repositories/messageRepository';
export * from './repositories/conversationRepository';
// ... all repositories

// Services
export * from './services/Auth.service';
export * from './services/Message.service';
// ... all services

// Controllers
export * from './controllers/auth.controller';
export * from './controllers/message.controller';
// ... all controllers

// Middleware
export * from './middleware/auth.middleware';
export * from './middleware/error.middleware';
```

**Then in tests:**

```typescript
// BEFORE:
import { MessageService } from '../../../../src/services/Message.service';
import { MessageRepository } from '../../../../src/repositories/messageRepository';

// AFTER:
import { MessageService, MessageRepository } from '../../../src';
```

**Effort:** 2 hours  
**Impact:** Cleaner imports

---

### 3.3 Create Client-Side Config Module

```typescript
// client/src/config.ts
export const config = {
  API_URL: process.env.REACT_APP_API_URL || 'http://localhost:8080/api',
  WS_URL: process.env.REACT_APP_WS_URL || 'ws://localhost:8080',
  UPLOAD_URL: process.env.REACT_APP_UPLOAD_URL || 'http://localhost:8080/uploads',
  
  // Feature flags
  FEATURES: {
    OMNI_CHANNEL: process.env.REACT_APP_FEATURE_OMNI === 'true',
    ATTENDANCE: process.env.REACT_APP_FEATURE_ATTENDANCE === 'true',
    MEETINGS: process.env.REACT_APP_FEATURE_MEETINGS === 'true',
  },
  
  // Pagination
  DEFAULT_PAGE_SIZE: 20,
  MESSAGES_PAGE_SIZE: 30,
  
  // WebSocket
  WS_HEARTBEAT_INTERVAL: 15000,
  WS_PONG_TIMEOUT: 5000,
  WS_MAX_RECONNECT_ATTEMPTS: 8,
  WS_RECONNECT_BASE_DELAY: 1000,
} as const;

export type Config = typeof config;
```

**Effort:** 1 hour  
**Impact:** Centralized client config

---

### 3.4 Split `App.css` (392 KB)

```
client/src/
├── App.css (REMOVE)
├── styles/
│   ├── globals.css (reset, typography, utilities)
│   ├── layout.css (sidebar, dashboard, header)
│   ├── chat.css (messages, composer, conversation list)
│   ├── attendance.css (clock controls, calendar)
│   ├── meetings.css (meeting cards, notes)
│   ├── tasks.css (task list, kanban)
│   ├── announcements.css (announcement cards)
│   ├── modals.css (call modal, file preview, forms)
│   ├── common.css (buttons, inputs, avatars)
│   └── animations.css (transitions, keyframes)
```

**Effort:** 1 day  
**Impact:** Easier to find and modify styles

---

## Summary: Prioritized Improvements

| Phase | Priority | Improvement | Effort | Impact |
|-------|----------|-------------|--------|--------|
| 1 | **HIGH** | Break `Dashboard.tsx` God Component | 2-3 days | Reduces cognitive load, enables parallel development |
| 1 | **HIGH** | Unify API shape (snake_case → camelCase) | 1-2 days | Eliminates type casts, improves readability |
| 1 | **HIGH** | Centralize configuration (`config.ts`) | 1 day | Single source of truth, validation |
| 2 | **MEDIUM** | Split `chatStore.ts` by domain | 2 days | Easier testing, clearer ownership |
| 2 | **MEDIUM** | Split `wsListeners.ts` by domain | 2 days | Easier testing, clearer ownership |
| 2 | **MEDIUM** | Split `container.ts` by module | 2-3 days | Enables parallel feature development |
| 2 | **MEDIUM** | Standardize controller error handling | 1 day | Consistent responses, less boilerplate |
| 2 | **MEDIUM** | Split `WsEventMap` by domain | 1 day | Better organization, type safety |
| 2 | **MEDIUM** | Standardize test organization | 1 day | Easier to find and run tests |
| 3 | **LOW** | Rename route files to match URLs | 1 hour | Consistency |
| 3 | **LOW** | Add barrel exports | 2 hours | Cleaner imports |
| 3 | **LOW** | Create client config module | 1 hour | Centralized client config |
| 3 | **LOW** | Split `App.css` | 1 day | Easier style maintenance |

---

## Quick Wins (Can Do Today)

These improvements have high impact but low effort:

1. **Create `server/src/config.ts`** — Eliminate 3 copies of `getSecret()` in 1 hour
2. **Rename route files** — Match file names to URL paths (1 hour)
3. **Fix indentation in `websocket.ts`** — Lines 263-267 (5 minutes)
4. **Add barrel exports to `server/src`** — Clean up imports (2 hours)

---

## Anti-Patterns to Avoid Going Forward

1. **Don't create God Components** — Keep views under 200 lines; extract to ViewModels
2. **Don't mix API shapes** — Choose camelCase or snake_case, normalize at the boundary
3. **Don't scatter `process.env`** — Always use the config module
4. **Don't create monolithic stores** — Split by domain from the start
5. **Don't bypass services** — Keep the layered architecture clean
6. **Don't create 340-line types** — Split by domain
7. **Don't put tests in random places** — Follow the source tree structure

---

## Implementation Order

```
Week 1:
  Day 1-2: Create config.ts, eliminate getSecret() duplication
  Day 3-4: Unify API shape (normalizeKeys in axios interceptor)
  Day 5: Quick wins (rename routes, fix indentation)

Week 2:
  Day 1-3: Extract ViewModels for attendance, meetings, tasks, announcements
  Day 4-5: Break Dashboard.tsx into panel components

Week 3:
  Day 1-2: Split chatStore.ts into domain stores
  Day 3-4: Split wsListeners.ts into domain listeners
  Day 5: Standardize controller error handling

Week 4:
  Day 1-3: Split container.ts into module files
  Day 4: Split WsEventMap by domain
  Day 5: Reorganize tests

Week 5+:
  Split App.css
  Add barrel exports
  Create client config module
```
