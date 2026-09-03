// Notification preference domain model — MVVM Model layer.
// Mirrors the server's category catalog; the API returns one entry per
// category with the user's current `enabled` state.
import api from '../services/api';

export interface NotificationPreference {
  category: string;
  label: string;
  description: string;
  enabled: boolean;
}

/** Display catalog (server returns the same list with `enabled` merged in). */
export const NOTIFICATION_PREFERENCE_CATEGORIES = [
  { category: 'messages', label: 'New messages', description: 'Direct messages and channel/team chats' },
  { category: 'mentions', label: '@mentions', description: 'When someone mentions you' },
  { category: 'meetings', label: 'Meeting invites & reminders', description: 'Invitations, changes and start reminders' },
  { category: 'announcements', label: 'Team announcements', description: 'Company-wide announcements' },
  { category: 'calls', label: 'Call notifications', description: 'Missed voice and video calls' },
  { category: 'reminders', label: 'Message reminders', description: '“Remind me about this message” alerts' },
  { category: 'tasks', label: 'Task assignments & deadlines', description: 'New assignments and due-date alerts' },
];

export const NotificationPreferenceModel = {
  getAll: () =>
    api.get<{ success: boolean; data: { preferences: NotificationPreference[] } }>(
      '/notification-preferences',
    ),
  set: (category: string, enabled: boolean) =>
    api.put<{ success: boolean; data: { preference: { category: string; enabled: boolean } } }>(
      '/notification-preferences',
      { category, enabled },
    ),
};
