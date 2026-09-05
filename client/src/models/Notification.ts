// Notification domain model — MVVM Model layer.
// Holds the `Notification` entity plus `NotificationModel`, the data access
// for the /notifications endpoints.
import api from '../services/api';
import type { Reaction } from './Message';

export interface Notification {
  id: number;
  user_id: number;
  actor_id?: number | null;
  type: string;
  title: string;
  message?: string | null;
  /** JSON payload — arrives as a string over REST for older rows, but as an
   *  already-parsed object for some shapes; both are handled everywhere. */
  data?: string | Record<string, unknown> | null;
  is_read: number;
  created_at: string;
  /** The target's current emoji reactions (message/announcement/task rows),
   *  attached by the server when the target has a reaction model. */
  reactions?: Reaction[];
}

export const NotificationModel = {
  getAll: () =>
    api.get<{ success: boolean; data: { notifications: Notification[] } }>(
      '/notifications',
    ),
  markRead: (id: number) =>
    api.patch<{ success: boolean; message: string }>(`/notifications/${id}/read`),
  markAllRead: () =>
    api.post<{ success: boolean; message: string }>('/notifications/read-all'),
};
