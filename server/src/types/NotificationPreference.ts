/**
 * Notification preference types — per-user opt-outs for notification
 * categories, mirroring the `user_notification_preferences` table.
 *
 * Categories are always-on by default: rows only exist when a user explicitly
 * toggled a category, and an `enabled = 0` row means "suppress this kind of
 * notification".
 */
export type NotificationCategory =
  | 'messages' // new_message rows for direct/channel/team chats
  | 'mentions' // @mention notifications
  | 'meetings' // meeting invites + meeting reminders
  | 'announcements' // team announcements
  | 'calls' // missed calls
  | 'reminders' // message reminders
  | 'tasks'; // task assignments + task deadlines

export interface NotificationCategoryInfo {
  category: NotificationCategory;
  label: string;
  description: string;
}

export const NOTIFICATION_CATEGORIES: NotificationCategoryInfo[] = [
  { category: 'messages', label: 'New messages', description: 'Direct messages and channel/team chats' },
  { category: 'mentions', label: '@mentions', description: 'When someone mentions you' },
  { category: 'meetings', label: 'Meeting invites & reminders', description: 'Invitations, changes and start reminders' },
  { category: 'announcements', label: 'Team announcements', description: 'Company-wide announcements' },
  { category: 'calls', label: 'Call notifications', description: 'Missed voice and video calls' },
  { category: 'reminders', label: 'Message reminders', description: '“Remind me about this message” alerts' },
  { category: 'tasks', label: 'Task assignments & deadlines', description: 'New assignments and due-date alerts' },
];

export interface NotificationPreferenceRow {
  user_id: number;
  category: NotificationCategory;
  enabled: number;
  created_at?: Date | string;
  updated_at?: Date | string;
}

export interface NotificationPreferenceInput {
  user_id: number;
  category: NotificationCategory;
  enabled: boolean;
}
