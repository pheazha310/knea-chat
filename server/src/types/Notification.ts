/** Notification types — mirror the `notifications` table. */

export interface NotificationRow {
  id: number;
  user_id: number;
  actor_id: number | null;
  type: string;
  title: string;
  message: string | null;
  /** Stored as a JSON string in the DB; parsed by clients. */
  data: string | null;
  is_read: number;
  created_at: Date | string;
  /** Reactions of the referenced entity (messages / announcements / tasks),
   *  attached by NotificationService so rows can show who reacted. */
  reactions?: unknown[];
}

export interface Notification extends NotificationRow {}

export interface CreateNotificationData {
  user_id: number;
  actor_id?: number | null;
  type: string;
  title: string;
  message?: string | null;
  data?: Record<string, unknown> | null;
}

export interface NotificationFilters {
  userId: number;
  page?: number;
  limit?: number;
  is_read?: string;
}
