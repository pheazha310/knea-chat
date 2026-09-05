// notificationStore — Zustand store for the notification center.
//
// Owns the notification list, the derived unread count and the set of
// conversations that have unread notifications. WebSocket `notification`
// events trigger a refresh (see wsListeners.ts); opening a conversation marks
// that conversation's notifications read via `markConversationRead`.
import { create } from 'zustand';
import { NotificationModel } from '../models';
import type { Notification, Reaction } from '../models';
import { conversationIdOf } from '../utils/notifications';
import { getErrorMessage } from './utils';

/** Read the conversationId embedded in a notification's JSON `data` field. */
const parseConversationId = (n: Notification): number | null => conversationIdOf(n);

/** Single source of truth for the derived unread state (count + conv ids). */
const computeUnreadState = (list: Notification[]) => {
  let count = 0;
  const convIds = new Set<number>();
  for (const n of list) {
    if (n.is_read) continue;
    count += 1;
    const id = parseConversationId(n);
    if (id !== null) convIds.add(id);
  }
  return { count, convIds };
};

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  unreadConversationIds: Set<number>;
  loading: boolean;
  error: string | null;
  setNotifications: (list: Notification[]) => void;
  /** Prepend a single notification row (optimistic additions). */
  addNotification: (notification: Notification) => void;
  /** Replace the reaction list attached to one row (used after quick reacts
   *  and live `*_reacted` broadcasts). */
  setNotificationReactions: (notificationId: number, reactions: Reaction[]) => void;
  load: () => Promise<void>;
  /** Re-fetch the list from the server (WS `notification` events use this). */
  refresh: () => Promise<void>;
  markRead: (notificationId: number) => Promise<void>;
  markAllRead: () => Promise<void>;
  markConversationRead: (conversationId: number) => Promise<void>;
  clear: () => void;
}

export const useNotificationStore = create<NotificationState>()((set, get) => ({
  notifications: [],
  unreadCount: 0,
  unreadConversationIds: new Set(),
  loading: false,
  error: null,

  setNotifications: (list) => {
    const { count, convIds } = computeUnreadState(list);
    set({ notifications: list, unreadCount: count, unreadConversationIds: convIds });
  },

  addNotification: (notification) => {
    const next = [notification, ...get().notifications];
    get().setNotifications(next);
  },

  setNotificationReactions: (notificationId, reactions) => {
    const next = get().notifications.map((n) =>
      n.id === notificationId ? { ...n, reactions } : n,
    );
    // Only touch state when something actually changed (rows may not exist).
    if (next.some((n, i) => n !== get().notifications[i])) {
      get().setNotifications(next);
    }
  },

  load: async () => {
    set({ loading: true, error: null });
    try {
      const res = await NotificationModel.getAll();
      get().setNotifications(res.data.data?.notifications || []);
      set({ loading: false });
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not load notifications'), loading: false });
    }
  },

  refresh: () => get().load(),

  markRead: async (notificationId) => {
    try {
      await NotificationModel.markRead(notificationId);
      const next = get().notifications.map((n) =>
        n.id === notificationId ? { ...n, is_read: 1 } : n,
      );
      get().setNotifications(next);
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not mark notification as read') });
    }
  },

  markAllRead: async () => {
    try {
      await NotificationModel.markAllRead();
      const next = get().notifications.map((n) => ({ ...n, is_read: 1 }));
      get().setNotifications(next);
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not mark all notifications as read') });
    }
  },

  markConversationRead: async (conversationId) => {
    const pending = get().notifications.filter(
      (n) => !n.is_read && parseConversationId(n) === conversationId,
    );
    if (pending.length === 0) return;
    try {
      await Promise.all(pending.map((n) => NotificationModel.markRead(n.id)));
      const next = get().notifications.map((n) =>
        parseConversationId(n) === conversationId ? { ...n, is_read: 1 } : n,
      );
      get().setNotifications(next);
    } catch (err) {
      set({ error: getErrorMessage(err, 'Could not mark conversation notifications as read') });
    }
  },

  clear: () => set({ notifications: [], unreadCount: 0, unreadConversationIds: new Set() }),
}));
