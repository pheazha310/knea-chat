// Notification domain model — MVVM Model layer.
// Holds the `Notification` entity plus `NotificationModel`, the data access
// for the /notifications endpoints.
import api from '../services/api';

export interface Notification {
  id: number;
  user_id: number;
  actor_id?: number | null;
  type: string;
  title: string;
  message?: string | null;
  data?: string | null;
  is_read: number;
  created_at: string;
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
